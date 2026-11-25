'use strict';
// Structural checks on the static site: every local file the pages reference must exist,
// the service worker must precache everything the pages need offline, and the manifest and
// icons must be valid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// Local <script src> and <link href> references from an HTML page (external URLs excluded).
const localRefs = (page) => {
  const html = read(page);
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((r) => !/^(https?:|data:|#|mailto:)/.test(r))
    .filter((r) => r !== 'viewer.html'); // navigation target, not an asset
};
const PAGES = ['index.html', 'about.html', 'viewer.html', 'settings.html'];

test('landing page is index.html and the sky view is viewer.html', () => {
  assert.ok(exists('index.html'));
  assert.ok(exists('viewer.html'));
  assert.match(read('index.html'), /<title>FarGems — allow location and compass<\/title>/);
  assert.match(read('viewer.html'), /<title>FarGems — sky view<\/title>/);
});

test('every local file referenced by each page exists', () => {
  for (const page of PAGES) {
    const refs = localRefs(page);
    assert.ok(refs.length > 0, `${page} has local references`);
    for (const r of refs) {
      assert.ok(exists(r.split('?')[0]), `${page} references missing file: ${r}`);
    }
  }
});

test('landing page links to the viewer and loads its scripts in order', () => {
  const html = read('index.html');
  assert.match(html, /href="viewer\.html"/);
  assert.ok(html.indexOf('lib/onboarding.js') < html.indexOf('landing.js'), 'onboarding before landing.js');
});

test('viewer loads logic and onboarding before app.js', () => {
  const html = read('viewer.html');
  const logic = html.indexOf('lib/logic.js');
  const onb = html.indexOf('lib/onboarding.js');
  const app = html.indexOf('src="app.js"');
  assert.ok(logic > -1 && onb > -1 && app > -1, 'all scripts present');
  assert.ok(logic < app && onb < app, 'helpers must load before app.js');
});

test('app.js takes its helpers from the shared globals', () => {
  const app = read('app.js');
  assert.match(app, /window\.FarGemsLogic/);
  assert.match(app, /window\.FarGemsOnboarding/);
});

test('landing.js binds to ids that exist on the landing page', () => {
  const js = read('landing.js');
  const html = read('index.html');
  const ids = [...js.matchAll(/\$\('#([A-Za-z]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5, 'landing.js looks up its elements');
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
});

test('landing.js starts the compass request synchronously inside the tap', () => {
  // iOS rejects requestPermission() after an await, so it must run before any await/then.
  const js = read('landing.js');
  const handler = js.slice(js.indexOf('function askPermissions()'));
  const req = handler.indexOf('DeviceOrientationEvent.requestPermission');
  assert.ok(req > -1, 'calls requestPermission');
  assert.equal(handler.slice(0, req).includes('await'), false, 'no await before the request');
  assert.ok(req < handler.indexOf('Promise.all'), 'compass started before waiting on results');
});

test('index.html and viewer.html pin the CDN libraries to exact versions', () => {
  for (const page of ['viewer.html']) {
    const html = read(page);
    assert.match(html, /satellite\.js@5\.0\.0\//);
    assert.match(html, /astronomy-engine@2\.1\.19\//);
  }
});

test('service worker precaches every local file both pages load', () => {
  const sw = read('sw.js');
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'SHELL list found');
  const precached = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  for (const page of PAGES) {
    for (const r of localRefs(page)) {
      assert.ok(precached.has(r), `${r} (from ${page}) is not precached`);
    }
  }
  assert.ok(precached.has('viewer.html'), 'viewer.html precached for offline use');
  for (const f of precached) {
    if (f === './') continue;
    assert.ok(exists(f), `precache entry missing on disk: ${f}`);
  }
});

test('manifest.webmanifest is valid JSON with installable fields and existing icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.start_url);
  assert.ok(m.icons.length >= 2);
  for (const icon of m.icons) {
    assert.ok(exists(icon.src), `icon ${icon.src}`);
  }
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
});

test('PNG icons have the PNG signature and expected dimensions', () => {
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.deepEqual([...buf.subarray(1, 4)], [0x50, 0x4e, 0x47], `${file} PNG magic`);
    assert.equal(buf.readUInt32BE(16), size, `${file} width`);
    assert.equal(buf.readUInt32BE(20), size, `${file} height`);
  }
});

test('.nojekyll exists for GitHub Pages and no custom domain is committed', () => {
  assert.ok(exists('.nojekyll'));
  // The project is open source: the custom domain comes from a repository variable, not from git.
  assert.ok(!exists('CNAME'), 'CNAME must not be committed');
});

test('JavaScript files parse', () => {
  for (const f of ['app.js', 'landing.js', 'lib/logic.js', 'lib/onboarding.js', 'sw.js']) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)]);
  }
});

test('about page shows the about section, inside the main column, with key facts', () => {
  const html = read('about.html');
  const m = html.match(/<section id="about"[^>]*>/);
  assert.ok(m, 'about section present');
  assert.ok(!/\shidden[\s>]/.test(m[0]), 'about section is not hidden');
  const mainOpen = html.indexOf('<main');
  const mainClose = html.indexOf('</main>');
  assert.ok(html.indexOf('id="about"') > mainOpen && html.indexOf('id="about"') < mainClose, 'inside main');
  for (const fact of ['What it shows', 'Layers and radar', 'Where the data comes from', 'Privacy', 'Limits', 'CelesTrak', 'astronomy-engine', 'stay on your device']) {
    assert.ok(html.includes(fact), `about section mentions: ${fact}`);
  }
});

test('logo: icon.svg is the FarGems logo, transparent, cropped, with no scripts or external links', () => {
  const svg = read('icon.svg');
  assert.match(svg, /<svg[^>]*aria-label="FarGems Logo"/);
  // Transparent: no full-canvas background rectangle.
  // The mask's own white rectangle is not painted background, so check outside the mask.
  const outsideMask = svg.replace(/<mask[\s\S]*?<\/mask>/g, '');
  assert.ok(!/<rect[^>]*width="512"[^>]*height="512"/.test(outsideMask), 'no full-canvas background rect');
  // Cropped: a square viewBox around the artwork, not the old 512 canvas.
  const vb = svg.match(/viewBox="([\d.\s-]+)"/)[1].trim().split(/\s+/).map(Number);
  assert.equal(vb[2], vb[3], 'viewBox is square');
  assert.ok(vb[2] < 300 && vb[2] > 200, `viewBox is cropped to the artwork (${vb[2]} units)`);
  assert.ok(!/<script/i.test(svg), 'no script elements');
  assert.ok(!/on[a-z]+=/i.test(svg), 'no event handler attributes');
  assert.ok(!/(xlink:)?href="https?:/i.test(svg), 'no external references');
});

test('logo: cut-outs are real holes (a mask), so no background colour is painted', () => {
  const svg = read('icon.svg');
  // No painted background colour anywhere, so the logo is transparent on any page colour.
  assert.ok(!/#070b14/i.test(svg), 'no painted background colour');
  assert.match(svg, /<mask id="cut"/, 'cut-out mask defined');
  assert.equal((svg.match(/mask="url\(#cut\)"/g) || []).length, 2, 'both diamond outlines use the mask');
});

test('logo: landing and viewer headers show the logo beside the wordmark', () => {
  assert.match(read('index.html'), /<img class="logo logo-lg" src="icon\.svg" alt="FarGems logo" width="112" height="112"/);
  assert.match(read('viewer.html'), /<img class="logo logo-sm" src="icon\.svg" alt="FarGems logo" width="34" height="34"/);
});

test('logo: PNG icons carry no provenance metadata chunks', () => {
  for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    let i = 8;
    const types = [];
    while (i < buf.length) {
      const n = buf.readUInt32BE(i);
      types.push(buf.subarray(i + 4, i + 8).toString('latin1'));
      i += 12 + n;
    }
    assert.ok(!types.includes('caBX'), `${f} has no caBX chunk`);
    assert.ok(!types.some((t) => /^(tEXt|zTXt|iTXt)$/.test(t)), `${f} has no text chunks`);
  }
});


test('settings page holds the configuration and the viewer does not', () => {
  const settings = read('settings.html');
  for (const id of ['geoBtn', 'manualForm', 'sampleBtn', 'compassBtn', 'flipToggle', 'unitSelect', 'layerList']) {
    assert.ok(settings.includes(`id="${id}"`), `settings has #${id}`);
  }
  const viewer = read('viewer.html');
  for (const id of ['compassBtn', 'flipBtn', 'northBtn', 'layersBtn', 'layersPanel', 'chips', 'lists', 'sheet', 'locBtn', 'unitBtn']) {
    assert.ok(!viewer.includes(`id="${id}"`), `viewer no longer has #${id}`);
  }
  assert.ok(viewer.includes('id="sky"') && viewer.includes('id="detail"'), 'viewer keeps the radar and selected-object card');
  assert.ok(viewer.includes('href="settings.html"'), 'viewer links to settings');
});

test('settings writes the choices the viewer reads, using the same keys', () => {
  const js = read('settings.js');
  const onboarding = read('lib/onboarding.js');
  // Location and compass go through the shared onboarding helpers, which own those keys.
  assert.ok(onboarding.includes("'fg.loc'") && onboarding.includes("'fg.compass'"), 'onboarding owns fg.loc and fg.compass');
  assert.match(js, /O\.storeLocation\(/, 'settings saves the location');
  assert.match(js, /O\.storeCompass\(/, 'settings saves the compass permission');
  for (const key of ['fg.flip', 'fg.unit', 'fg.layers']) {
    assert.ok(js.includes(`'${key}'`), `settings writes ${key}`);
  }
  const app = read('app.js');
  assert.match(app, /storedValue\('fg\.flip'\)/, 'viewer reads fg.flip');
  assert.match(app, /L\.loadLayers\(storedValue\('fg\.layers'\)/, 'viewer reads fg.layers');
  assert.match(app, /fg\.unit/, 'viewer reads the unit');
});

test('the sky view keeps the radar and the selected object, and drops the feed lists', () => {
  const app = read('app.js');
  assert.ok(!/function renderLists|function renderChips|function renderLayers/.test(app), 'list and chip rendering removed');
  assert.match(app, /Tap an object on the radar/, 'empty selection shows a hint');
  assert.match(app, /\$\('#noLocation'\)\.hidden = false/, 'without a location the viewer points to settings');
});

test('sample location opens the sky view directly, without permissions', () => {
  const js = read('landing.js');
  const handler = js.slice(js.indexOf("els.sample.addEventListener('click'"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert.match(body, /storeLocation\(storage, s\.lat, s\.lon\)/, 'stores the sample location');
  assert.match(body, /location\.href = 'viewer\.html'/, 'goes to the viewer');
  assert.ok(!/askPermissions|requestLocation|requestPermission/.test(body), 'does not ask for permissions');
});

test('radar zoom: the viewer has zoom buttons and the radar uses the shared zoom functions', () => {
  const html = read('viewer.html');
  for (const id of ['zoomIn', 'zoomOut', 'zoomReset']) assert.ok(html.includes(`id="${id}"`), `viewer has #${id}`);
  const app = read('app.js');
  assert.match(app, /FarGemsLogic\.zoomAt\(/, 'wheel and buttons zoom about a point');
  assert.match(app, /FarGemsLogic\.panBy\(/, 'drag pans when zoomed in');
  assert.match(app, /FarGemsLogic\.pinchFactor\(/, 'two fingers pinch to zoom');
  assert.match(app, /const V = state\.view;/, 'the dome is drawn with the view');
  assert.match(app, /\$\('#zoomReset'\)\.onclick = resetView/, 'reset returns to the default view');
});

test('nearby list: two pages with tabs, a swipe between them, and distances on the objects', () => {
  const html = read('viewer.html');
  for (const id of ['tabRadar', 'tabNearby', 'pager', 'pageRadar', 'pageNearby', 'nearbyList']) {
    assert.ok(html.includes(`id="${id}"`), `viewer has #${id}`);
  }
  const app = read('app.js');
  assert.match(app, /\.sortNearest\(/, 'list is sorted nearest first');
  assert.match(app, /\.describeDirection\(/, 'each row says where to look');
  assert.match(app, /FarGemsLogic\.swipeDirection\(/, 'swipes switch the page');
  assert.match(app, /distKm: eq\.dist \* AU_KM/, 'planets and the Sun and Moon have a distance');
  assert.match(app, /distKm: la\.rangeSat/, 'satellites have a distance');
  assert.match(app, /distKm: L\.range/, 'aircraft have a distance');
  assert.match(app, /if \(e\.target\.closest\('#sky, \.zoombar'\)\) return;/, 'swipes that start on the radar are left alone');
});
