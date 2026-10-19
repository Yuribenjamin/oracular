// Runs the built CommonJS output as a consumer would, resolving '@oracular/react' and 'oracular'
// by name through their exports maps.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createIntentStore, localStorageAdapter } = require('@oracular/react');
const { STATE_VERSION } = require('oracular');

assert.ok(
  require.resolve('@oracular/react').endsWith(`${path.sep}dist${path.sep}index.cjs`),
  'require resolves to dist/index.cjs',
);

const T = 1_700_000_000_000;
const memory = new Map();
const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const config = {
  intents: {
    upgrade: {
      prior: 0.05,
      priorStrength: 10,
      halfLife: 7 * 864e5,
      signals: { 'pricing.viewed': 3 },
    },
  },
};
const store = createIntentStore(config, {
  persist: localStorageAdapter('k', storage),
  now: () => T,
});
store.track('pricing.viewed');
assert.ok(store.getState().intents.upgrade.alpha > 0.5);
store.flush().then(() => {
  assert.equal(JSON.parse(memory.get('k')).version, STATE_VERSION);
  console.log(`smoke ok (@oracular/react cjs, node ${process.version})`);
});
