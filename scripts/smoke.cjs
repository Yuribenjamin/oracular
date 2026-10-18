'use strict';
// Runs the built CommonJS output through the package's own `exports` map.
const assert = require('node:assert/strict');
const {
  createState,
  ms,
  observe,
  predict,
  shouldReveal,
  STATE_VERSION,
  validateConfig,
} = require('oracular');

const config = {
  intents: {
    upgrade: {
      prior: 0.05,
      priorStrength: 10,
      halfLife: 1000,
      signals: { 'pricing.viewed': 3 },
    },
  },
};

const before = createState(config);
const after = observe(before, { name: 'pricing.viewed', at: 1 });
const p0 = predict(before, 'upgrade', 2).p;
const p1 = predict(after, 'upgrade', 2).p;

assert.equal(STATE_VERSION, 3);
// Through the exports map, require() must land on the CommonJS build.
const resolved = require.resolve('oracular');
assert.ok(resolved.endsWith('/dist/index.cjs'), `require.resolve('oracular') → ${resolved}`);
assert.ok(p0 >= 0 && p0 <= 1, 'p0 in [0,1]');
assert.ok(p1 >= 0 && p1 <= 1, 'p1 in [0,1]');
assert.ok(p1 > p0, 'a positive signal raises p');
assert.equal(typeof shouldReveal(after, 'upgrade', 2), 'boolean');
assert.deepEqual(validateConfig(config), before.config);
assert.equal(ms.days(1), 86_400_000);

console.log(`smoke ok (cjs, node ${process.version})`);
