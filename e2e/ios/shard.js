'use strict';
// Splits one test file across several runs, so CI can run the shards at the same time and the results come back in the time
// of the slowest shard instead of the sum of all of them.
//
//   FG_SHARD=2/4 node --test e2e/ios/safari.e2e.js     runs the 2nd quarter of the tests
//
// Each test file loads this instead of 'node:test'. The tests are numbered in the order the file registers them, and test
// number n belongs to shard (n mod total) + 1, so the slow and the quick ones are spread evenly. With no FG_SHARD every
// test runs. The tests do not depend on each other (each one opens its own browser context), so any split is safe.
const nodeTest = require('node:test');

// Which shard (1 to total) owns test number n (counting from 0).
function owner(n, total) { return (n % total) + 1; }

// "2/4" gives { index: 2, total: 4 }; anything else (or nothing) means one shard that runs everything.
function parseShard(text) {
  const m = /^(\d+)\/(\d+)$/.exec(String(text || '').trim());
  if (!m) return { index: 1, total: 1 };
  const index = Number(m[1]), total = Number(m[2]);
  return index >= 1 && total >= 1 && index <= total ? { index, total } : { index: 1, total: 1 };
}

const shard = parseShard(process.env.FG_SHARD);
let n = 0;
function test(...args) {
  const mine = shard.total === 1 || owner(n++, shard.total) === shard.index;
  return mine ? nodeTest(...args) : undefined;
}
test.before = (...a) => nodeTest.before(...a);
test.after = (...a) => nodeTest.after(...a);

module.exports = { test, owner, parseShard, shard };
