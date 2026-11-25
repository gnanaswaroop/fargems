'use strict';
// Search and sharing: page heads, the build step that fills in the address, and keeping the address out of git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scripts/seo.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('cleanDomain accepts a bare host name and rejects anything else', () => {
  assert.equal(S.cleanDomain('Example.COM'), 'example.com');
  assert.equal(S.cleanDomain('https://example.com/'), 'example.com');
  assert.equal(S.cleanDomain('  www.example.org '), 'www.example.org');
  assert.equal(S.cleanDomain('localhost:8080'), 'localhost:8080');
  for (const bad of ['', null, undefined, 'a b', 'x"><script>', 'exa/mple.com', '-bad.com']) assert.equal(S.cleanDomain(bad), '', String(bad));
});

test('fillPlaceholders writes the address, or drops the lines that need it', () => {
  const html = 'a\n<link href="__SITE_URL__/">\nb\n';
  assert.equal(S.fillPlaceholders(html, 'example.com'), 'a\n<link href="https://example.com/">\nb\n');
  assert.equal(S.fillPlaceholders(html, ''), 'a\nb\n');
});

test('sitemap and robots point at the site, and robots still works with no address', () => {
  const xml = S.sitemapXml('example.com');
  assert.match(xml, /<loc>https:\/\/example\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/about\.html<\/loc>/);
  assert.doesNotMatch(xml, /viewer|settings/, 'app pages are not listed');
  assert.match(S.robotsTxt('example.com'), /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  assert.doesNotMatch(S.robotsTxt(''), /Sitemap/);
  assert.match(S.robotsTxt(''), /Allow: \//);
});

function build(domain) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-seo-'));
  for (const f of ['index.html', 'about.html']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  S.applySeo(dir, domain);
  return dir;
}

test('building with a domain fills every placeholder and keeps the structured data valid', () => {
  const dir = build('example.com');
  for (const f of ['index.html', 'about.html']) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!html.includes('__SITE_URL__'), f);
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\//);
    assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/og-image\.png">/);
  }
  const ld = JSON.parse(fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.url, 'https://example.com/');
  assert.equal(ld['@type'], 'WebApplication');
  assert.ok(fs.existsSync(path.join(dir, 'sitemap.xml')));
  fs.rmSync(dir, { recursive: true });
});

test('building with no domain leaves valid pages with no canonical or address-based tags', () => {
  const dir = build('');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!html.includes('__SITE_URL__'));
  assert.doesNotMatch(html, /rel="canonical"|og:url|og:image"/);
  assert.match(html, /<meta name="description"/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.url, undefined);
  assert.equal(ld.name, 'FarGems');
  assert.ok(!fs.existsSync(path.join(dir, 'sitemap.xml')));
  fs.rmSync(dir, { recursive: true });
});

test('the two public pages have a title, description, canonical, share tags and one h1', () => {
  for (const f of ['index.html', 'about.html']) {
    const html = read(f);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(title.length >= 15 && title.length <= 70, `${f} title length ${title.length}`);
    assert.ok(desc.length >= 70 && desc.length <= 170, `${f} description length ${desc.length}`);
    assert.match(html, /<link rel="canonical" href="__SITE_URL__/);
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) assert.ok(html.includes(tag), `${f} has ${tag}`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${f} has exactly one h1`);
    assert.doesNotMatch(html, /noindex/, 'public page is indexable');
  }
  assert.notEqual(read('index.html').match(/<title>([^<]+)/)[1], read('about.html').match(/<title>([^<]+)/)[1]);
});

test('the app pages are kept out of search results', () => {
  for (const f of ['viewer.html', 'settings.html']) assert.match(read(f), /<meta name="robots" content="noindex">/, f);
});

test('the home page links to About near the top and in the footer', () => {
  const html = read('index.html');
  assert.match(html, /<nav class="topnav"[^>]*>[\s\S]*href="about\.html"/);
  assert.match(html, /<footer class="foot">[\s\S]*href="about\.html"/);
  assert.ok((html.match(/href="about\.html"/g) || []).length >= 3);
});

test('the site address is never written into the repository files, and the build runs the SEO step', () => {
  assert.match(read('.github/workflows/pages.yml'), /node scripts\/seo\.js _site "\$PAGES_DOMAIN"/);
  assert.match(read('.github/workflows/pages.yml'), /og-image\.png/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'og-image.png')));
  const png = fs.readFileSync(path.join(__dirname, '..', 'og-image.png'));
  assert.equal(png.readUInt32BE(16), 1200, 'share image is 1200 wide');
  assert.equal(png.readUInt32BE(20), 630, 'and 630 tall');
  for (const f of ['index.html', 'about.html', 'manifest.webmanifest', 'scripts/seo.js']) assert.doesNotMatch(read(f), /fargems\.com|swaroop\.in/, f);
});
