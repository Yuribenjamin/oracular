// Runs the built ESM output as a consumer would, renders the hook on the server with
// react-dom/server (which exercises the server snapshot), and checks the declarations import
// the engine by name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIntentStore, useIntent } from '@oracular/react';
import { STATE_VERSION } from 'oracular';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

if (typeof import.meta.resolve === 'function') {
  assert.ok(import.meta.resolve('@oracular/react').endsWith('/dist/index.js'));
}

const T = 1_700_000_000_000;
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
const store = createIntentStore(config, { now: () => T });
store.track('pricing.viewed');

function App() {
  const { predict, state } = useIntent(store);
  return createElement('p', null, `${predict('upgrade').p.toFixed(3)} ${state.version}`);
}
const html = renderToString(createElement(App));
assert.match(html, new RegExp(`0\\.\\d{3} ${STATE_VERSION}`));

const dts = readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8');
assert.match(dts, /from 'oracular'/);
assert.doesNotMatch(dts, /\.\.\/src/);
console.log(`smoke ok (@oracular/react esm, node ${process.version})`);
