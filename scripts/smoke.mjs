// Runs the built ESM output through the package's own `exports` map.
import assert from 'node:assert/strict';
import {
  createState,
  ms,
  observe,
  predict,
  STATE_VERSION,
  shouldReveal,
  validateConfig,
} from 'oracular';

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

assert.equal(STATE_VERSION, 2);
// Through the exports map, import must land on the ESM build (import.meta.resolve: Node ≥ 18.19).
if (typeof import.meta.resolve === 'function') {
  const resolved = import.meta.resolve('oracular');
  assert.ok(resolved.endsWith('/dist/index.js'), `import.meta.resolve('oracular') → ${resolved}`);
} else {
  console.log('import.meta.resolve unavailable on this Node; skipped the ESM resolution check');
}
assert.ok(p0 >= 0 && p0 <= 1, 'p0 in [0,1]');
assert.ok(p1 >= 0 && p1 <= 1, 'p1 in [0,1]');
assert.ok(p1 > p0, 'a positive signal raises p');
assert.equal(typeof shouldReveal(after, 'upgrade', 2), 'boolean');
assert.deepEqual(validateConfig(config), before.config);
assert.equal(ms.days(1), 86_400_000);

console.log(`smoke ok (esm, node ${process.version})`);
