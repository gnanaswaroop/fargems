// FarGems aircraft proxy (Cloudflare Worker).
// Browsers cannot read the aircraft APIs directly (they send no CORS headers), so this worker
// fetches them server-side and returns the result with CORS headers.
//
// Free-tier friendly: each area (a 0.25 degree cell) is cached for 30 seconds, so every visitor in
// the same area shares one upstream request. The upstream load therefore depends on how many
// areas are active, not on how many phones are polling.
//
// Configuration (set as Worker variables, not in the repository):
//   ALLOWED_ORIGINS  comma-separated list of site origins allowed to read the data,
//                    e.g. "https://example.com,https://example.org". Local origins are always allowed.

const UPSTREAM = [
  { name: 'adsb.lol', url: (lat, lon, r) => 'https://api.adsb.lol/v2/point/' + lat + '/' + lon + '/' + r },
  { name: 'airplanes.live', url: (lat, lon, r) => 'https://api.airplanes.live/v2/point/' + lat + '/' + lon + '/' + r },
];

// Identifies the project to the providers. No personal contact details.
export const USER_AGENT = 'FarGems-proxy/1.0 (+https://github.com/gnanaswaroop/fargems)';

const CACHE_SECONDS = 30;
const CELL_DEG = 0.25;
const DEFAULT_RADIUS = 150;
const MAX_RADIUS = 250;
const ROUTE_CACHE_SECONDS = 1800;     // a flight keeps its route for hours, so share one lookup between all visitors
const ROUTE_MISS_CACHE_SECONDS = 600; // flights with no known route are remembered for less time
// adsbdb.com is a free flight-route database that needs no key.
const ROUTE_UPSTREAM = 'https://api.adsbdb.com/v0/callsign/';

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

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
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

// Fetch from the first provider that answers. Returns { body, provider } or null.
async function fetchUpstream(q, fetchImpl) {
  for (const p of UPSTREAM) {
    try {
      const res = await fetchImpl(p.url(q.lat, q.lon, q.r), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const body = await res.text();
      JSON.parse(body); // refuse non-JSON (for example an HTML error page)
      return { body, provider: p.name };
    } catch {
      // try the next provider
    }
  }
  return null;
}

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

async function fetchRoute(callsign, fetchImpl) {
  try {
    const res = await fetchImpl(ROUTE_UPSTREAM + callsign, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.status === 404) return { callsign, origin: null, destination: null }; // flight not in the database
    if (!res.ok) return null;
    return normalizeRoute(JSON.parse(await res.text()), callsign);
  } catch {
    return null;
  }
}

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

// Main entry. Dependencies (fetchImpl, cache) are passed in so the logic can be tested.
export async function handle(request, env, { fetchImpl = fetch, cache = caches.default } = {}) {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, { ...cors, Allow: 'GET, OPTIONS' });

  const url = new URL(request.url);
  if (url.pathname === '/route') return handleRoute(url, cors, fetchImpl, cache);
  if (url.pathname !== '/aircraft') return json(404, { error: 'not found' }, cors);

  const q = parseQuery(url);
  if (!q) return json(400, { error: 'lat and lon are required numbers; r is optional' }, cors);

  // Cache by cell, not by the exact point, so nearby visitors share the same upstream response.
  const cacheUrl = new URL('https://cache.local/aircraft/' + cellKey(q.lat, q.lon, q.r));
  const cacheKey = new Request(cacheUrl.toString());
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Cache', 'HIT');
    return new Response(hit.body, { status: 200, headers });
  }

  // Query the centre of the cell, so every visitor in the cell gets the same answer.
  const cellLat = Math.round(q.lat / CELL_DEG) * CELL_DEG;
  const cellLon = Math.round(q.lon / CELL_DEG) * CELL_DEG;
  const upstream = await fetchUpstream({ lat: cellLat.toFixed(2), lon: cellLon.toFixed(2), r: q.r }, fetchImpl);
  if (!upstream) return json(502, { error: 'aircraft data unavailable' }, cors);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=' + CACHE_SECONDS,
    'X-Provider': upstream.provider,
    ...cors,
  };
  const response = new Response(upstream.body, { status: 200, headers });
  await cache.put(cacheKey, new Response(upstream.body, { status: 200, headers: { 'Cache-Control': 'max-age=' + CACHE_SECONDS, 'Content-Type': 'application/json; charset=utf-8' } }));
  response.headers.set('X-Cache', 'MISS');
  return response;
}

async function handleRoute(url, cors, fetchImpl, cache) {
  const callsign = parseCallsign(url);
  if (!callsign) return json(400, { error: 'callsign is required (letters and digits, 2 to 8 long)' }, cors);
  // Cached by callsign alone: every visitor looking at the same flight shares one lookup.
  const cacheKey = new Request('https://cache.local/route/' + callsign);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Cache', 'HIT');
    return new Response(hit.body, { status: 200, headers });
  }
  const route = await fetchRoute(callsign, fetchImpl);
  if (!route) return json(502, { error: 'route data unavailable' }, cors);
  const known = !!(route.origin && route.destination);
  const ttl = known ? ROUTE_CACHE_SECONDS : ROUTE_MISS_CACHE_SECONDS;
  const body = JSON.stringify(route);
  await cache.put(cacheKey, new Response(body, { status: 200, headers: { 'Cache-Control': 'max-age=' + ttl, 'Content-Type': 'application/json; charset=utf-8' } }));
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl, 'X-Cache': 'MISS', ...cors },
  });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
