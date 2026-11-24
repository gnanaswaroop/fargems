'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require('../scripts/serve-https.js');

const ROOT = path.resolve(__dirname, '..');

test('contentType maps the site file types and falls back to octet-stream', () => {
  assert.equal(S.contentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(S.contentType('lib/logic.js'), 'text/javascript; charset=utf-8');
  assert.equal(S.contentType('style.css'), 'text/css; charset=utf-8');
  assert.equal(S.contentType('manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(S.contentType('icon.svg'), 'image/svg+xml');
  assert.equal(S.contentType('icon-192.png'), 'image/png');
  assert.equal(S.contentType('APP.JS'), 'text/javascript; charset=utf-8', 'extension match is case-insensitive');
  assert.equal(S.contentType('archive.bin'), 'application/octet-stream');
});

test('resolveRequest maps / to index.html and folders to their index.html', () => {
  assert.equal(S.resolveRequest(ROOT, '/'), path.join(ROOT, 'index.html'));
  assert.equal(S.resolveRequest(ROOT, '/lib/'), path.join(ROOT, 'lib', 'index.html'));
});

test('resolveRequest ignores query strings and decodes percent-encoding', () => {
  assert.equal(S.resolveRequest(ROOT, '/viewer.html?x=1'), path.join(ROOT, 'viewer.html'));
  assert.equal(S.resolveRequest(ROOT, '/lib/logic%2Ejs'), path.join(ROOT, 'lib', 'logic.js'));
});

test('resolveRequest keeps traversal attempts inside the project root', () => {
  // URL parsing collapses ../ (and %2e%2e) at the root, so these resolve to files inside it.
  const inside = (u) => {
    const f = S.resolveRequest(ROOT, u);
    assert.ok(f && f.startsWith(ROOT + path.sep), `${u} stays inside the root`);
  };
  inside('/../package.json');
  inside('/%2e%2e/package.json');
  inside('/lib/../../etc/passwd');
  assert.equal(S.resolveRequest(ROOT, '/../package.json'), path.join(ROOT, 'package.json'));
});

test('resolveRequest returns null when the resolved path would leave the root', () => {
  // An encoded slash is not a path separator to URL parsing, so a name like this stays a single segment.
  assert.equal(S.resolveRequest('/nonexistent-root/x', '/..%2f..%2fsecret'), null);
});

test('resolveRequest returns null for malformed encoding', () => {
  assert.equal(S.resolveRequest(ROOT, '/%E0%A4%A'), null);
});

test('certArgs puts the LAN IP, localhost and 127.0.0.1 in the certificate', () => {
  const args = S.certArgs('192.168.1.20', 'c.pem', 'k.pem');
  const san = args[args.indexOf('-addext') + 1];
  assert.equal(san, 'subjectAltName=IP:192.168.1.20,IP:127.0.0.1,DNS:localhost');
  assert.equal(args[args.indexOf('-out') + 1], 'c.pem');
  assert.equal(args[args.indexOf('-keyout') + 1], 'k.pem');
  assert.equal(args[0], 'req');
});

test('lanAddresses returns only non-internal IPv4 addresses', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    wifi: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.68.55' },
    ],
  };
  assert.deepEqual(S.lanAddresses(ifaces), ['192.168.68.55']);
  assert.deepEqual(S.lanAddresses({}), []);
});

test('MIME table covers every file type the site ships', () => {
  const shipped = ['.html', '.js', '.css', '.webmanifest', '.svg', '.png'];
  for (const ext of shipped) assert.ok(S.MIME[ext], `MIME for ${ext}`);
});

test('package.json exposes npm run serve:https and its script exists', () => {
  const fs = require('node:fs');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['serve:https'], 'node scripts/serve-https.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'serve-https.js')));
});
