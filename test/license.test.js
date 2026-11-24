'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('LICENSE is the MIT license with a copyright line', () => {
  const text = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) \d{4} \S/);
  assert.match(text, /Permission is hereby granted, free of charge/);
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('package.json declares the MIT license', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
});
