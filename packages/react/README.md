# @oracular/react

React bindings for [oracular](https://github.com/Yuribenjamin/oracular), the on-device intent engine: a framework-free store, the `useIntent` hook, a provider, and persistence adapters for `localStorage`, AsyncStorage and MMKV. Nothing leaves the device.

```sh
npm install oracular @oracular/react
```

```tsx
import { createIntentStore, localStorageAdapter, useIntent } from '@oracular/react';
import { presets } from 'oracular/presets';

const store = createIntentStore(
  { episodeTimeout: 30 * 60 * 1000, intents: { upgrade: presets.upgrade } },
  { persist: localStorageAdapter() },
);

function Pricing() {
  const { track, reveal } = useIntent(store);
  return (
    <button onClick={() => { track('pricing.viewed'); if (reveal('upgrade')) openOffer(); }}>
      See plans
    </button>
  );
}
```

`useIntent` returns `state` (the rendered snapshot), `track`, `shouldReveal`, `reveal` (check and mark in one step), `predict`, `explain`, `evaluate`, `endEpisode` and the `store`. Reads go to the store's current state, so `track` followed by `reveal` in the same click sees the event. On mount the hook loads the persisted state and replays anything tracked before the load resolved; it flushes the pending save on `pagehide`, when the page becomes hidden, and on unmount.

It never ends an episode on those events: a short switch away is not a session boundary, and ending the episode there would give the signals seen so far a miss and leave the outcome a minute later with nothing to credit. Set `episodeTimeout` in the config and idle gaps close episodes on their own; call `endEpisode` yourself on sign-out. On React Native, use `asyncStorageAdapter(key, AsyncStorage)` or `mmkvAdapter(key, mmkv)` and call `store.flush()` when `AppState` leaves `active`.

Peer dependencies: `oracular` and `react >= 18`. The full guide, with the lifecycle for Vue, React Native and Node, is at https://yuribenjamin.github.io/oracular/guide/frameworks.
