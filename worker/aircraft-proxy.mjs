// FarGems data proxy (Cloudflare Worker).
// Browsers cannot read the aircraft APIs directly (they send no CORS headers), and the free public feeds throttle
// or block heavy use. This worker fetches them server-side, shares each answer between all visitors, and keeps
// working when a provider throttles, blocks or goes down.
//
// Endpoints (all GET, all with CORS for allowed origins):
//   /aircraft?lat=&lon=&r=   aircraft around a point, as { ac: [...] } in the readsb "v2" format
//   /route?callsign=         where a flight is coming from and going to
//   /tle?group=              satellite element sets for "stations" or "visual", as plain text
//   /status                  which providers are currently healthy (no provider is called)
//
// How it copes with throttling (see docs/IMPLEMENTATION.md for the full story):
//   - Each kind of data has an ordered list of providers. The first healthy one that answers wins.
//   - A provider that fails is put on a cooldown and skipped until it ends: HTTP 429 or 503 for the time in
//     Retry-After (default 60 s, at most 10 min), 401 or 403 for an hour (blocked), anything else (a timeout, a
//     server error, a bad payload) for 15 s that doubles with each failure in a row, up to 5 min.
//   - Every provider call has a timeout, so one slow provider cannot hold up the answer.
//   - Answers are cached by area (aircraft), flight (route) or group (satellites), so the load on providers depends
//     on how many areas are active, not on how many phones are polling.
//   - When every provider fails, the last good answer is served (marked X-Cache: STALE) for a while, instead of an
//     error. Only when there is nothing to serve does the caller get a 502, with the reason for each provider.
//
// Configuration (set as Worker variables, not in the repository):
//   ALLOWED_ORIGINS  comma-separated list of site origins allowed to read the data,
//                    e.g. "https://example.com,https://example.org". Local origins are always allowed.
//   ENABLED          kill switch. Set to "false" (or 0, off, no) and the worker answers 503 at once, without
//                    contacting any provider or reading its cache. Remove it or set "true" to turn the worker back on.

// Identifies the project to the providers. No personal contact details.
export const USER_AGENT = 'FarGems-proxy/1.0 (+https://github.com/gnanaswaroop/fargems)';

const CELL_DEG = 0.25;
const DEFAULT_RADIUS = 150;
const MAX_RADIUS = 250;
const PROVIDER_TIMEOUT_MS = 6000;

// How long an answer counts as fresh, and how long it may still be served when every provider is failing.
const AIRCRAFT_FRESH_S = 30, AIRCRAFT_STALE_S = 180;        // planes move fast, so stale positions stop being useful quickly
const ROUTE_FRESH_S = 1800, ROUTE_MISS_FRESH_S = 600, ROUTE_STALE_S = 86400; // a flight keeps its route for hours
const TLE_FRESH_S = 21600, TLE_STALE_S = 259200;            // element sets stay usable for days

export const TLE_GROUPS = ['stations', 'visual'];

/* ---------- small helpers ---------- */

// Cells group nearby points so one upstream request serves all of them.
export function cellKey(lat, lon, r) {
  const la = Math.round(lat / CELL_DEG) * CELL_DEG;
  const lo = Math.round(lon / CELL_DEG) * CELL_DEG;
  return la.toFixed(2) + ',' + lo.toFixed(2) + ',' + r;
}

// Returns { lat, lon, r } or null if the query is missing, not numeric, or out of range.
export function parseQuery(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const rRaw = url.searchParams.get('r');
  const r = rRaw === null ? DEFAULT_RADIUS : Math.min(Number(rRaw), MAX_RADIUS);
  if (url.searchParams.get('lat') === null || url.searchParams.get('lon') === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(r) || r <= 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, r };
}

// True when the owner has switched the worker off with the ENABLED variable.
export function isDisabled(env) {
  return ['0', 'false', 'off', 'no', 'disabled'].includes(String(env && env.ENABLED != null ? env.ENABLED : '').trim().toLowerCase());
}

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// CORS headers for a request origin. Unknown origins get no Allow-Origin header, so the browser refuses them.
export function corsHeaders(origin, env) {
  const h = { Vary: 'Origin' };
  if (!origin) return h;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (local || allowedOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/* ---------- provider health: cooldowns ---------- */

// What the worker remembers about each provider, per running instance: { fails, until, reason }.
// It is passed in (and reset) by the tests. In production one shared map lives as long as the instance does.
const sharedHealth = new Map();
export function resetHealth(health = sharedHealth) { health.clear(); }

// Retry-After is either a number of seconds or an HTTP date. Returns seconds, or null.
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, (t - now) / 1000) : null;
}

// How long to leave a provider alone after a failure. `fails` counts failures in a row, including this one.
export function cooldownMs(failure, fails) {
  const s = failure.status;
  if (s === 401 || s === 403) return 3600e3;                                  // blocked: do not keep knocking
  if (s === 429 || s === 503) return Math.min(600, failure.retryAfter != null ? failure.retryAfter : 60) * 1000; // throttled
  return Math.min(300, 15 * 2 ** Math.max(0, fails - 1)) * 1000;              // anything else: back off 15 s, 30 s, 60 s...
}

function describe(failure) {
  if (failure.status) return 'HTTP ' + failure.status;
  return failure.kind || 'failed';
}

function noteFailure(health, name, failure, now) {
  const h = health.get(name) || { fails: 0, until: 0, reason: '' };
  h.fails += 1;
  h.until = now + cooldownMs(failure, h.fails);
  h.reason = describe(failure);
  health.set(name, h);
}
function noteSuccess(health, name) { health.delete(name); }

/* ---------- one provider call ---------- */

// Calls one URL with a timeout and sorts the outcome. Returns { ok: true, text } or { ok: false, kind, status?, retryAfter? }.
async function attempt(fetchImpl, url, { timeoutMs = PROVIDER_TIMEOUT_MS, now = Date.now() } = {}) {
  const init = { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain' } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutMs);
  let res;
  try { res = await fetchImpl(url, init); } catch (e) {
    return { ok: false, kind: e && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  if (!res.ok) return { ok: false, kind: 'http', status: res.status, retryAfter: parseRetryAfter(res.headers && res.headers.get('Retry-After'), now) };
  try { return { ok: true, text: await res.text() }; } catch { return { ok: false, kind: 'unreadable' }; }
}

/* ---------- the provider chain ---------- */

// providers: [{ name, get(args, ctx) -> { ok, body, ... } | { ok: false, ... }, isEmpty?(body) }]
// Returns { ok: true, body, provider, tried } or { ok: false, tried }. `tried` lists what happened with each provider.
export async function runProviders(providers, args, { fetchImpl, health = sharedHealth, now = Date.now, timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  const tried = [];
  const t0 = now();
  let ready = providers.filter((p) => (health.get(p.name) || { until: 0 }).until <= t0);
  for (const p of providers) if (!ready.includes(p)) tried.push({ provider: p.name, skipped: (health.get(p.name) || {}).reason || 'cooling down' });
  if (!ready.length && providers.length) {
    // Everything is cooling down. Try the one whose cooldown ends first, so a full outage can still recover.
    ready = [[...providers].sort((a, b) => health.get(a.name).until - health.get(b.name).until)[0]];
  }
  let emptyAnswer = null;
  for (const p of ready) {
    const r = await p.get(args, { fetchImpl, now: now(), timeoutMs });
    if (r.ok) {
      noteSuccess(health, p.name);
      tried.push({ provider: p.name, ok: true });
      if (p.isEmpty && p.isEmpty(r.body)) { emptyAnswer = emptyAnswer || { ok: true, body: r.body, provider: p.name }; continue; } // "unknown": ask the next one too
      return { ...r, provider: p.name, tried };
    }
    noteFailure(health, p.name, r, now());
    tried.push({ provider: p.name, failed: describe(r) });
  }
  if (emptyAnswer) return { ...emptyAnswer, tried };
  return { ok: false, tried };
}

/* ---------- aircraft providers ---------- */

// readsb-style feeds (adsb.lol, adsb.fi) answer { ac: [...] } or { aircraft: [...] }. Normalised to { ac }.
function parseReadsb(text) {
  const j = JSON.parse(text); // refuse non-JSON (for example an HTML error page)
  const list = Array.isArray(j.ac) ? j.ac : (Array.isArray(j.aircraft) ? j.aircraft : null);
  if (!list) throw new Error('no aircraft list');
  return JSON.stringify({ ac: list, now: j.now != null ? j.now : (j.timestamp != null ? j.timestamp : undefined) });
}

// OpenSky answers { states: [[icao24, callsign, country, t, t, lon, lat, baro m, on_ground, m/s, track, m/s, ...]] }.
// Converted to the same shape as the others (feet, knots, feet per minute) so the app needs only one parser.
export function parseOpenSky(text) {
  const j = JSON.parse(text);
  if (!Array.isArray(j.states) && j.states !== null) throw new Error('no states list');
  const ac = (j.states || []).filter((s) => Array.isArray(s) && typeof s[6] === 'number' && typeof s[5] === 'number').map((s) => {
    const altM = s[7] != null ? s[7] : s[13];
    const a = { hex: String(s[0] || ''), flight: String(s[1] || '').trim(), lat: s[6], lon: s[5], gs: Math.round((s[9] || 0) * 1.94384), track: s[10] || 0, baro_rate: Math.round((s[11] || 0) * 196.85) };
    a.alt_baro = s[8] ? 'ground' : (altM != null ? Math.round(altM * 3.28084) : null);
    return a;
  });
  return JSON.stringify({ ac, now: j.time });
}

function openSkyUrl(lat, lon, r) {
  const la = Number(lat), lo = Number(lon), dLat = r / 60, dLon = r / (60 * Math.max(0.2, Math.cos(la * Math.PI / 180)));
  const f = (n) => n.toFixed(3);
  return 'https://opensky-network.org/api/states/all?lamin=' + f(Math.max(-90, la - dLat)) + '&lomin=' + f(lo - dLon) + '&lamax=' + f(Math.min(90, la + dLat)) + '&lomax=' + f(lo + dLon);
}

// A provider that is one URL whose text is turned into the answer by `parse`.
function urlProvider(name, urlFor, parse, extra = {}) {
  return {
    name,
    async get(args, ctx) {
      const r = await attempt(ctx.fetchImpl, urlFor(args), ctx);
      if (!r.ok) return r;
      try { return { ok: true, body: parse(r.text, args) }; } catch { return { ok: false, kind: 'bad payload' }; }
    },
    ...extra,
  };
}

// In order of preference. airplanes.live and adsb.one now refuse anonymous clients (HTTP 403), so they are not used.
export const AIRCRAFT_PROVIDERS = [
  urlProvider('adsb.lol', (q) => 'https://api.adsb.lol/v2/point/' + q.lat + '/' + q.lon + '/' + q.r, parseReadsb),
  urlProvider('adsb.fi', (q) => 'https://opendata.adsb.fi/api/v2/lat/' + q.lat + '/lon/' + q.lon + '/dist/' + q.r, parseReadsb),
  urlProvider('opensky', (q) => openSkyUrl(q.lat, q.lon, q.r), parseOpenSky),
];

/* ---------- route providers ---------- */

// Reduce one airport record to the fields the app shows.
function airport(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { iata: a.iata_code || '', icao: a.icao_code || '', name: a.name || '', city: a.municipality || '', country: a.country_iso_name || '' };
  if (typeof a.latitude === 'number' && typeof a.longitude === 'number') { out.lat = a.latitude; out.lon = a.longitude; }
  return out.iata || out.icao || out.name ? out : null;
}

// Turn adsbdb's answer ({ response: { flightroute: { origin, destination } } }) into { callsign, origin, destination }.
// Unknown flights (the provider answers with a text message) give nulls.
export function normalizeRoute(upstream, callsign) {
  const fr = upstream && upstream.response && typeof upstream.response === 'object' ? upstream.response.flightroute : null;
  const origin = fr ? airport(fr.origin) : null, destination = fr ? airport(fr.destination) : null;
  if (!origin || !destination) return { callsign, origin: null, destination: null };
  return { callsign, origin, destination };
}

// Callsigns are letters and digits, 2 to 8 long. Anything else is refused before it is sent upstream.
export function parseCallsign(url) {
  const c = String(url.searchParams.get('callsign') || '').trim().toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(c) ? c : null;
}

const noRoute = (callsign) => JSON.stringify({ callsign, origin: null, destination: null });
const isNoRoute = (body) => { try { const r = JSON.parse(body); return !(r.origin && r.destination); } catch { return true; } };

const adsbdb = {
  name: 'adsbdb',
  async get({ callsign }, ctx) {
    const r = await attempt(ctx.fetchImpl, 'https://api.adsbdb.com/v0/callsign/' + callsign, ctx);
    if (!r.ok) return r.status === 404 ? { ok: true, body: noRoute(callsign) } : r; // 404: the flight is not in the database
    try { return { ok: true, body: JSON.stringify(normalizeRoute(JSON.parse(r.text), callsign)) }; } catch { return { ok: false, kind: 'bad payload' }; }
  },
  isEmpty: isNoRoute,
};

// hexdb.io answers the route as plain text such as "KEWR-VABB" (airports by ICAO code), and each airport separately.
const hexdb = {
  name: 'hexdb',
  async get({ callsign }, ctx) {
    const r = await attempt(ctx.fetchImpl, 'https://hexdb.io/callsign-route?callsign=' + callsign, ctx);
    if (!r.ok) return r.status === 404 ? { ok: true, body: noRoute(callsign) } : r;
    const codes = r.text.trim().toUpperCase().split('-').filter((c) => /^[A-Z0-9]{3,4}$/.test(c));
    if (codes.length < 2) return { ok: true, body: noRoute(callsign) };
    const look = async (icao) => {
      const a = await attempt(ctx.fetchImpl, 'https://hexdb.io/api/v1/airport/icao/' + icao, ctx);
      if (!a.ok) return null;
      try {
        const j = JSON.parse(a.text);
        return airport({ iata_code: j.iata, icao_code: j.icao || icao, name: j.airport, municipality: j.region_name, country_iso_name: j.country_code, latitude: j.latitude, longitude: j.longitude });
      } catch { return null; }
    };
    const [origin, destination] = await Promise.all([look(codes[0]), look(codes[codes.length - 1])]);
    if (!origin || !destination) return { ok: false, kind: 'bad payload' };
    return { ok: true, body: JSON.stringify({ callsign, origin, destination }) };
  },
  isEmpty: isNoRoute,
};

export const ROUTE_PROVIDERS = [adsbdb, hexdb];

/* ---------- satellite element set providers ---------- */

const looksLikeTLE = (text) => /^1 \d{5}/m.test(text) && /^2 \d{5}/m.test(text);
const tleText = (t) => { if (!looksLikeTLE(t)) throw new Error('not element sets'); return t; };

// Space stations, if CelesTrak is down: individual element sets from a mirror database (ISS, Tiangong modules).
const STATION_IDS = [25544, 48274, 53239, 54216];
const tleMirror = {
  name: 'tle-api',
  groups: ['stations'],
  async get(_args, ctx) {
    const parts = await Promise.all(STATION_IDS.map(async (id) => {
      const r = await attempt(ctx.fetchImpl, 'https://tle.ivanstanojevic.me/api/tle/' + id, ctx);
      if (!r.ok) return r;
      try { const j = JSON.parse(r.text); return j.line1 && j.line2 ? { ok: true, text: [j.name || String(id), j.line1, j.line2].join('\n') } : { ok: false, kind: 'bad payload' }; } catch { return { ok: false, kind: 'bad payload' }; }
    }));
    const good = parts.filter((p) => p.ok);
    if (!good.length) return parts[0];
    return { ok: true, body: good.map((p) => p.text).join('\n') + '\n' };
  },
};

export const TLE_PROVIDERS = [
  urlProvider('celestrak', (a) => 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + a.group + '&FORMAT=tle', tleText, { groups: ['stations', 'visual'] }),
  tleMirror,
  urlProvider('ariss', () => 'https://live.ariss.org/iss.txt', tleText, { groups: ['stations'] }),
];

/* ---------- cached, cooled-down fetching ---------- */

// Answers are stored with the time they were stored and how long they stay fresh, and kept for the stale period.
async function readEntry(cache, key, now) {
  const hit = await cache.match(new Request(key));
  if (!hit) return null;
  const storedAt = Number(hit.headers.get('X-Stored-At')) || 0;
  const freshFor = Number(hit.headers.get('X-Fresh-For')) || 0;
  const ageS = storedAt ? Math.max(0, (now - storedAt) / 1000) : Infinity;
  return { res: hit, ageS, fresh: ageS < freshFor, freshFor, provider: hit.headers.get('X-Provider') || '' };
}

async function writeEntry(cache, key, body, { type, provider, freshFor, staleFor, now }) {
  await cache.put(new Request(key), new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'max-age=' + staleFor, 'X-Stored-At': String(now), 'X-Fresh-For': String(freshFor), 'X-Provider': provider },
  }));
}

// The shared flow for every cached kind: fresh hit, else ask the providers, else serve stale, else fail.
async function cachedAnswer({ key, providers, args, type, staleFor, freshFor, cors, fetchImpl, cache, health, now, what }) {
  const t = now();
  const entry = await readEntry(cache, key, t);
  const send = (body, provider, state, extra = {}) => new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'X-Provider': provider || 'unknown', 'X-Cache': state, ...extra, ...cors },
  });
  if (entry && entry.fresh) {
    return send(await entry.res.text(), entry.provider, 'HIT', { 'Cache-Control': 'public, max-age=' + Math.max(1, Math.floor(entry.freshFor - entry.ageS)) });
  }
  const r = await runProviders(providers, args, { fetchImpl, health, now });
  if (r.ok) {
    const fresh = freshFor(r.body);
    await writeEntry(cache, key, r.body, { type, provider: r.provider, freshFor: fresh, staleFor, now: t });
    return send(r.body, r.provider, 'MISS', { 'Cache-Control': 'public, max-age=' + fresh });
  }
  if (entry && entry.ageS <= staleFor) {
    return send(await entry.res.text(), entry.provider, 'STALE', { 'Cache-Control': 'public, max-age=10', 'X-Stale-Age': String(Math.round(entry.ageS)) });
  }
  return json(502, { error: what + ' unavailable', tried: r.tried }, { ...cors, 'Retry-After': '10' });
}

/* ---------- main entry ---------- */

// Dependencies (fetchImpl, cache, health, now) are passed in so the logic can be tested.
export async function handle(request, env, { fetchImpl = fetch, cache = caches.default, health = sharedHealth, now = Date.now } = {}) {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, { ...cors, Allow: 'GET, OPTIONS' });

  if (isDisabled(env)) return json(503, { error: 'proxy switched off', disabled: true }, { ...cors, 'Retry-After': '3600' });

  const url = new URL(request.url);
  const common = { cors, fetchImpl, cache, health, now };

  if (url.pathname === '/status') return handleStatus(cors, health, now);

  if (url.pathname === '/route') {
    const callsign = parseCallsign(url);
    if (!callsign) return json(400, { error: 'callsign is required (letters and digits, 2 to 8 long)' }, cors);
    // Cached by callsign alone: every visitor looking at the same flight shares one lookup.
    return cachedAnswer({
      ...common, key: 'https://cache.local/route/' + callsign, providers: ROUTE_PROVIDERS, args: { callsign },
      type: 'application/json; charset=utf-8', staleFor: ROUTE_STALE_S, what: 'route data',
      freshFor: (body) => (isNoRoute(body) ? ROUTE_MISS_FRESH_S : ROUTE_FRESH_S), // flights with no known route are remembered for less time
    });
  }

  if (url.pathname === '/tle') {
    const group = String(url.searchParams.get('group') || '');
    if (!TLE_GROUPS.includes(group)) return json(400, { error: 'group must be one of ' + TLE_GROUPS.join(', ') }, cors);
    return cachedAnswer({
      ...common, key: 'https://cache.local/tle/' + group, providers: TLE_PROVIDERS.filter((p) => p.groups.includes(group)), args: { group },
      type: 'text/plain; charset=utf-8', staleFor: TLE_STALE_S, what: 'satellite data', freshFor: () => TLE_FRESH_S,
    });
  }

  if (url.pathname !== '/aircraft') return json(404, { error: 'not found' }, cors);

  const q = parseQuery(url);
  if (!q) return json(400, { error: 'lat and lon are required numbers; r is optional' }, cors);
  // Cache by cell, not by the exact point, so nearby visitors share the same upstream response. The query goes to
  // the centre of the cell, so every visitor in the cell gets the same answer.
  const cellLat = Math.round(q.lat / CELL_DEG) * CELL_DEG;
  const cellLon = Math.round(q.lon / CELL_DEG) * CELL_DEG;
  return cachedAnswer({
    ...common, key: 'https://cache.local/aircraft/' + cellKey(q.lat, q.lon, q.r), providers: AIRCRAFT_PROVIDERS,
    args: { lat: cellLat.toFixed(2), lon: cellLon.toFixed(2), r: q.r },
    type: 'application/json; charset=utf-8', staleFor: AIRCRAFT_STALE_S, what: 'aircraft data', freshFor: () => AIRCRAFT_FRESH_S,
  });
}

// Which providers are healthy right now, as this instance sees them. Calls no provider, so it is free to poll.
function handleStatus(cors, health, now) {
  const t = now();
  const list = (providers) => providers.map((p) => {
    const h = health.get(p.name);
    return h && h.until > t ? { provider: p.name, state: 'cooling down', reason: h.reason, retryInSeconds: Math.ceil((h.until - t) / 1000) } : { provider: p.name, state: 'ok' };
  });
  return json(200, {
    note: 'Per instance: a freshly started instance knows nothing yet and shows every provider as ok.',
    aircraft: list(AIRCRAFT_PROVIDERS), route: list(ROUTE_PROVIDERS), tle: list(TLE_PROVIDERS),
  }, { ...cors, 'Cache-Control': 'no-store' });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
