# Quickstart

The whole engine in fourteen lines. This block is the file `examples/quickstart.ts` in the repository, executed by the test suite, so it always runs:

<<< ../../examples/quickstart.ts

With these numbers the offer fires after roughly six strong signals inside a week (p must clear 0.5 with a 90% lower bound); lower `priorStrength` or raise the weights to fire sooner. The [Tuning guide](/guide/tuning) has the tables.

## What each line does

1. **`createState(config)`** builds the state. The `upgrade` intent starts at its prior: 5% likely, held with the strength of 10 observations (α = 0.5, β = 9.5). A normalized copy of the config is stored inside the state.
2. **`observe(state, event)`** feeds an event. `pricing.viewed` is a signal of `upgrade` with weight 3, so 3 pseudo-counts are added to α and the signal is remembered for this episode. Any other event name is ignored by this intent. The call returns a new state; the old one is untouched.
3. **`shouldReveal(state, 'upgrade', now)`** is true when p ≥ 0.5 **and** p − 1.28·sd ≥ 0.5, and no cooldown is running. One `pricing.viewed` gives p ≈ 0.27, so it is false here.
4. **`markRevealed(state, 'upgrade', now)`** records that you acted, starting a cooldown (by default one half-life, a week) during which `shouldReveal` stays false.

## The rest of a real integration

A real app also persists the state and ends episodes. Here is the complete minimal shape for a web app:

```ts
import {
  createState, deserialize, endEpisode, markRevealed, observe, serialize, shouldReveal,
  type EngineConfig,
} from 'oracular';

const config: EngineConfig = {
  episodeTimeout: 30 * 60 * 1000, // a 30-minute gap ends a session on its own
  intents: {
    upgrade: {
      prior: 0.05, priorStrength: 10, halfLife: 7 * 24 * 60 * 60 * 1000,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    },
  },
};

// Load: always pass the config your app ships now, so changed weights apply
// and signals you removed are pruned. Fall back to a fresh state.
const saved = localStorage.getItem('oracular');
let state = saved ? deserialize(saved, { config }) : createState(config);

function persist() {
  localStorage.setItem('oracular', serialize(state));
}

export function track(name: string) {
  const now = Date.now();
  state = observe(state, { name, at: now });
  if (shouldReveal(state, 'upgrade', now)) {
    showUpgradeOffer();
    state = markRevealed(state, 'upgrade', now);
  }
  persist();
}

// End the episode when the session ends, so signals that were not followed by
// the outcome get their miss and the engine can learn from it.
window.addEventListener('pagehide', () => {
  state = endEpisode(state, Date.now());
  persist();
});
```

Call `track('pricing.viewed')`, `track('limit.hit')` and `track('upgrade.completed')` from the places in your app where those things happen. That is the entire integration.

## Next

- [Intents & priors](/guide/concepts/intents-and-priors): what `prior` and `priorStrength` mean.
- [Episodes & learning](/guide/concepts/episodes-and-learning): why `endEpisode` and `outcome` matter.
- [Persistence](/guide/persistence): why `deserialize` takes the config.
- [Using with frameworks](/guide/frameworks): the same lifecycle in React, Vue, React Native and Node.
