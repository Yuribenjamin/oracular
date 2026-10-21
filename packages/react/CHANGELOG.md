# @oracular/react

## 0.2.2

### Patch Changes

- [#67](https://github.com/Yuribenjamin/oracular/pull/67) [`709d782`](https://github.com/Yuribenjamin/oracular/commit/709d782013941762dbd52e4f0e33639221bdf858) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Hydration with a store that loaded first.** The hooks hydrated with the store's current state, so following the cold-start advice, `await store.load()` before the first screen renders, under server rendering made the client's first render disagree with the markup the server sent: React reported a hydration mismatch and rendered the tree again. `useIntent`'s `state`, `usePrediction` and `useIntentSelector` now hydrate with the fresh state the server rendered, `store.getInitialState()` (new: the state the store was created with, the same object for its life), and then show the loaded one; `usePrediction` is computed from that snapshot rather than read from the store, with the same re-rendering as before. The functions `useIntent` returns go to the current state, as documented, and belong in handlers in a server-rendered tree.
  
  **An adapter that returns `undefined` counts as an empty key.** An adapter written in JavaScript that answered `undefined` instead of `null` for a missing key was treated as unreadable data: reported as `'parse'`, writes blocked until `clear()`. It is now an empty key, as the shipped adapters already report.

## 0.2.1

### Patch Changes

- [#60](https://github.com/Yuribenjamin/oracular/pull/60) [`ac0b2bc`](https://github.com/Yuribenjamin/oracular/commit/ac0b2bc586cc76e3e6ac9db1831dddf5403cd6d4) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **A parse failure is reported once and stops the re-reads.** Stored data that `deserialize` rejects blocked writes, as it should, but every debounced save then read it again, parsed it again and reported `'parse'` again, for data that cannot parse any better the second time. Saves after a parse failure now read and write nothing; `load()` reads again and reports only when the stored data changed, and `clear()` starts over, which is the handling to pass: `onError: (error, phase) => { if (phase === 'parse') void store.clear(); }`. A read that throws is still retried by every save, since the next attempt may succeed.
  
  **An empty key counts as saved.** A store that found nothing stored wrote a fresh state on the first flush or unmount even when nothing had been tracked, and so did a store after `clear()`. An empty key holds what a fresh state holds, so those writes are gone; the first event writes as before.
  
  **Cold start, in the docs.** Before the read settles, `reveal` decides on the state in memory, not on the stored history. The README and the guide now say to `await store.load()` before the first screen renders where a nudge there must respect a stored cooldown.

## 0.2.0

### Minor Changes

- [#54](https://github.com/Yuribenjamin/oracular/pull/54) [`5811274`](https://github.com/Yuribenjamin/oracular/commit/58112748fe944286b81ebcca1083d84421feac47) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **The store never writes before it has read.** A production audit of 0.1.0 found that a `flush()` during the first read (React's StrictMode double effect, a component unmounting at once, an `AppState` flush at cold start, or the debounced save falling due before a slow read) wrote the fresh in-memory state over the stored history, and that a load whose write landed first then marked that fresh state as saved, so the history was gone for good. Now nothing is written until the read has settled: a flush during it waits, and then writes only if the merged state differs from what was read. Everything tracked before the read settles, including before `load()` is called, is replayed onto the loaded state, stamped at the time it happened rather than when the read finished. `load()` returns the same promise to every caller while a read is in flight, and a store that has loaded does not read again.
  
  **A failed read blocks writes and is retried.** A read that throws is reported as `onError(error, 'load')`, stored data that cannot be parsed as `onError(error, 'parse')` (the two were one phase before); either leaves the store working in memory, writes nothing, and is retried by the next save, `flush()`, `load()` or `flushOnBackground`'s return to the foreground, with everything tracked meanwhile replayed. `clear()` is the explicit way to start over. `PersistPhase` is `'load' | 'parse' | 'save' | 'clear'`; a callback that annotated the old two-member union needs the new type. Without `onError`, a development build warns once per phase through `console.warn`; production stays silent.
  
  **A lifecycle.** `store.clear()` resets the state, removes the stored key (adapters gained `remove`, using `removeItem` or `delete` when the storage has it) and allows writes again: sign-out, "forget me", an account switch. `store.dispose()` cancels the pending save and stops further reads and writes, resolving once no write is in flight, so wiping the storage afterwards cannot be undone by a late save. `store.getStatus()` reports `memory`, `idle`, `loading`, `loaded`, `failed` or `disposed`. Writes run one at a time, so a slow adapter cannot land them out of order. A subscriber that throws no longer stops the subscribers after it or the save: the save is scheduled first, every subscriber runs, and the first error is rethrown.
  
  **Rendering less.** `usePrediction(store, intent, opts?)` re-renders only when that intent's state changes, so an event no intent declares, or one for another intent, leaves the component alone; `useIntentSelector(store, selector, isEqual?)` does the same for any selection; `useIntentStore()` returns the provider's store without subscribing. `IntentProvider` now runs the store's lifecycle itself (load on mount, flush on page hide and unmount), so a tree that only uses these hooks still loads and saves.
  
  **React Native.** `flushOnBackground(store, AppState)` flushes when the app leaves the foreground and retries a failed read when it returns; `pagehide` and `visibilitychange` never fire there, so the hook alone only flushed on unmount.
  
  **Size.** `{ useIntent, localStorageAdapter }` goes from 1.09 kB to 1.81 kB minified and gzipped (react and oracular external) and its budget from 1.5 kB to 2 kB; a second entry budgets the whole package at 2.7 kB (2.44 kB shipped).

## 0.1.0

### Minor Changes

- [#49](https://github.com/Yuribenjamin/oracular/pull/49) [`59da0c2`](https://github.com/Yuribenjamin/oracular/commit/59da0c226a1cba2570cbdb261efbc1d2b3f3fb0f) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **React bindings.** `@oracular/react` is the React binding for oracular, built on a framework-free store. `createIntentStore(config, { persist, now, saveDelay, onError })` holds one engine state with a clock, subscribers and persistence: `track`, `observe`, `endEpisode`, `markRevealed`, `reveal` (check and mark in one step), `load` and `flush`. Saves are debounced and skipped when the string has not changed, written at once when an episode closes, and a load replays whatever was tracked while it was pending, so the first screens' events are never lost. `useIntent(store)` binds a component through `useSyncExternalStore`, with reads going to the current state rather than a render-time copy, so `track` then `reveal` in one click sees the event; `IntentProvider` and `useIntentContext()` share a store through context; `useIntent(config, options)` gives one component its own. The hook loads on mount and flushes on `pagehide`, when the page becomes hidden, and on unmount, and never ends an episode on those events: a short switch away is not a session boundary. The adapters `localStorageAdapter`, `asyncStorageAdapter` and `mmkvAdapter` take the storage object in, so the package has no dependencies beyond its peers, `oracular >=0.8.0 <2` and `react >=18`. Tested on React 18 and 19.
