'use strict';
// Layout checks for the Layers panel. These catch the bug where the global text-input rule
// (full-width, flex-grow, padding) also applies to the checkboxes in the panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'viewer.html'), 'utf8');

// Declarations of the first rule whose selector matches `re`. Comments are removed first.
function declarations(re) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = src.match(re);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}

const globalInput = () => declarations(/(?:^|\n|\})\s*input\s*\{([^}]*)\}/);
const checkboxOverride = () => declarations(/\.layer-row input\[type="checkbox"\]\s*\{([^}]*)\}/);

test('the layers checkbox has its own rule', () => {
  assert.ok(checkboxOverride(), 'a `.layer-row input[type="checkbox"]` rule exists');
});

test('the checkbox rule resets every property the global text-input rule would change', () => {
  const global = globalInput();
  const box = checkboxOverride();
  assert.ok(global, 'global input rule found');
  // Properties that make a text box stretch or pad. A checkbox must not inherit them.
  const risky = ['flex', 'min-width', 'padding', 'background', 'border', 'font'].filter((p) => p in global);
  assert.ok(risky.length >= 4, 'the global input rule sets the properties this test guards');
  for (const p of risky) {
    assert.ok(p in box, `checkbox rule must reset "${p}" (global input sets ${p}: ${global[p]})`);
  }
});

test('the checkbox does not stretch: flex-basis auto and a fixed size', () => {
  const box = checkboxOverride();
  assert.equal(box.flex, '0 0 auto', 'checkbox is not flex-grown');
  assert.equal(box.width, '16px');
  assert.equal(box.height, '16px');
});

test('label text sits next to its checkbox, left-aligned', () => {
  const row = declarations(/\.layer-row\s*\{([^}]*)\}/);
  assert.ok(row, '.layer-row rule exists');
  assert.equal(row['text-align'], 'left', 'row text is left-aligned');
  assert.equal(row['align-items'], 'center', 'checkbox and text share a baseline');
  assert.match(row['flex-wrap'] || 'nowrap', /nowrap/, 'the checkbox and its label stay on one line');
});

test('the layers list is a two-column grid on phones, one column on very narrow screens', () => {
  const list = declarations(/\.layer-list\s*\{([^}]*)\}/);
  assert.match(list['grid-template-columns'], /1fr 1fr/);
  assert.ok(/@media \(max-width: 380px\)\s*\{\s*\.layer-list\s*\{\s*grid-template-columns:\s*1fr/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'narrow fallback');
});

test('each layer row is a label wrapping one checkbox (markup matches the CSS selectors)', () => {
  // The JS builds `<label class="layer-row"><input type="checkbox">…</label>`; keep that shape.
  const app = ['src/ui/hud.js', 'app.js'].map((f) => fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '').join('\n');
  assert.match(app, /class="layer-row"><input type="checkbox"/);
  assert.match(html, /id="layerList"/);
});
