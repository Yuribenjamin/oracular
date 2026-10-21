# @oracular/react

React bindings for [oracular](https://github.com/Yuribenjamin/oracular), the on-device intent engine: a framework-free store, the `useIntent` hook, a provider, selector hooks, and persistence adapters for `localStorage`, AsyncStorage and MMKV. Nothing leaves the device.

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

`useIntent` returns `state` (the rendered snapshot), `track`, `shouldReveal`, `reveal` (check and mark in one step), `predict`, `explain`, `evaluate`, `endEpisode` and the `store`. Reads go to the store's current state, so `track` followed by `reveal` in the same click sees the event. The functions keep their identity across renders, so a memo that should follow the state depends on `state`, not on them. `useIntent(config, options)` gives one component a store of its own, created on the first render and kept whatever config later renders pass; `IntentProvider` and `useIntentContext()` share a store through context.

On mount the hook loads the persisted state and flushes the pending save on `pagehide`, when the page becomes hidden, and on unmount. It never ends an episode on those events: a short switch away is not a session boundary, and ending the episode there would give the signals seen so far a miss and leave the outcome a minute later with nothing to credit. Set `episodeTimeout` in the config and idle gaps close episodes on their own; call `endEpisode` yourself on sign-out.

**Persistence rules.** The store never writes before the stored state has been read: a flush during the read waits for it, and anything tracked meanwhile is replayed onto the loaded state, stamped at the time it happened. A read that fails is reported through `onError(error, 'load')`, leaves the store working in memory, blocks writes so the stored history is never overwritten, and is retried by the next save, `flush()`, `load()` or return to the foreground. Stored data that cannot be parsed is reported once as `'parse'` and blocks writes the same way, but saves do not read it again, since the same bytes would fail the same way: `load()` reads again and reports only if the stored data changed, and `clear()` starts over, which is the usual handling: `onError: (error, phase) => { if (phase === 'parse') void store.clear(); }`. The other phases are `'save'` and `'clear'`. Without `onError`, a development build warns once per phase in the console. Saves are debounced (`saveDelay`, 250 ms), skipped when nothing changed, written at once when an episode closes, and run one at a time. `store.getStatus()` says where it stands.

**Cold start.** Before the read settles, `reveal` decides on the state in memory, not on the stored history, so a nudge on the first screen can show although the stored state has it in cooldown. Where that matters, `await store.load()` before the first screen renders (on React Native, before hiding the splash screen): the first `reveal` then sees the stored history.

**Server rendering.** The server renders the fresh state: it has no storage, and effects do not run there. The hooks hydrate with that same fresh state (`store.getInitialState()`, the state the store was created with) and then show the loaded one, so `await store.load()` before hydration is safe for `state`, `usePrediction` and `useIntentSelector`, which render from their snapshot. The functions the hook returns, `predict`, `explain`, `evaluate` and `shouldReveal`, read the state as it is now, which may already be the loaded one: in a tree the server rendered, keep them in handlers and render from `state` or `usePrediction`.

**Sign-out.** `await store.clear()` forgets the user: a fresh state in memory, the stored key removed, and writes allowed again (it is also the way out after a failed read or parse). To wipe the storage yourself, `await store.dispose()` first: it cancels the pending save and stops further writes, resolving once nothing is in flight; `flush()` before it if the last state should be kept.

**Rendering less.** `useIntent` re-renders on every change, including events no intent declares. `usePrediction(store, intent, opts?)` re-renders only when that intent's state changes, and `useIntentSelector(store, selector, isEqual?)` only when its selection does; `useIntentStore()` returns the provider's store without subscribing, for a component that only tracks or reveals in handlers. A prediction is as of the last change or render: a cooldown ending on its own does not re-render, so schedule a check on `suppressedUntil` where that matters.

On React Native, use `asyncStorageAdapter(key, AsyncStorage)` or `mmkvAdapter(key, mmkv)` and add `flushOnBackground(store, AppState)` with React Native's `AppState`: `pagehide` and `visibilitychange` do not exist there, so without it the hook would only flush on unmount. It flushes when the app leaves the foreground and retries a failed read when it comes back.

Peer dependencies: `oracular` and `react >= 18`. The full guide, with the lifecycle for Vue, React Native and Node, is at https://yuribenjamin.github.io/oracular/guide/frameworks.
