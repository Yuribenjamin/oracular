# Using with frameworks

oracular ships one binding, [`@oracular/react`](#react). The Vue, React Native and Node sections are **userland examples** of the same lifecycle, to adapt rather than copy. Each one shows the full loop, because the loop is where mistakes happen:

1. **Load** with `deserialize(saved, { config })`, falling back to `createState(config)`. Passing the current config is what makes new weights apply and removed signals disappear; loading without it restores the old snapshot and runs your old weights.
2. **Observe** events with a timestamp.
3. **Persist** every time the state changes.
4. **Let episodes end.** Set `episodeTimeout` and let idle gaps close episodes; call `endEpisode` on sign-out. Do **not** end an episode on `pagehide`, `visibilitychange` or the app going to the background: a short switch away is not a session boundary, and ending it there gives the signals seen so far a miss and leaves the outcome a minute later with nothing to credit. Flush the pending save on those events instead.
5. **Reveal** when `shouldReveal` is true, then `markRevealed`.

The config is shared by all examples:

```ts
// intent-config.ts
import type { EngineConfig } from 'oracular';

export const config: EngineConfig = {
  episodeTimeout: 30 * 60 * 1000,
  intents: {
    upgrade: {
      prior: 0.05, priorStrength: 10, halfLife: 7 * 24 * 60 * 60 * 1000,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    },
  },
};
```

## React

Install the binding next to the engine:

```sh
npm install oracular @oracular/react
```

`createIntentStore` holds one engine state with a clock, subscribers and persistence; `useIntent` binds a component to it through `useSyncExternalStore`. Reads go to the store's current state, not to a render-time copy, so `track` followed by `reveal` in the same click sees the event.

```tsx
import { createIntentStore, localStorageAdapter, useIntent } from '@oracular/react';
import { config } from './intent-config';

// Once, for the app: persisted in localStorage, loaded on first mount.
export const store = createIntentStore(config, { persist: localStorageAdapter() });

export function Pricing() {
  const { track, reveal, predict } = useIntent(store);
  return (
    <button onClick={() => { track('pricing.viewed'); if (reveal('upgrade')) openOffer(); }}>
      See plans ({predict('upgrade').p.toFixed(2)})
    </button>
  );
}
```

The hook returns `state` (the rendered snapshot), `track`, `shouldReveal`, `reveal` (check and mark in one step), `predict`, `explain`, `evaluate`, `endEpisode` and the `store`. On mount it loads the persisted state and replays anything tracked before the load resolved; it flushes the pending save when the page becomes hidden, on `pagehide` and on unmount, and never ends an episode on those events. Saves are debounced (250 ms) and skipped when nothing changed, and written at once when an episode closes. `IntentProvider` and `useIntentContext()` share one store through context; `useIntent(config, options)` gives a single component a store of its own. The clock is injectable (`now` in the options), so tests stay deterministic. A runnable version of this page, with the inspector in a side panel, is [`examples/react-vite`](https://github.com/Yuribenjamin/oracular/tree/main/examples/react-vite) in the repository.

::: details Without the package
The same loop over `useState`, persisting to `localStorage` on every change. It is what the package replaces: reads here see the state of the last render, so a `track` followed by a `reveal` in the same handler misses the event.

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  createState, deserialize, markRevealed, observe, serialize, shouldReveal,
  type EngineState,
} from 'oracular';
import { config } from './intent-config';

const KEY = 'oracular';

function load(): EngineState {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? deserialize(saved, { config }) : createState(config);
  } catch {
    return createState(config); // corrupt or incompatible: start fresh
  }
}

export function useIntent() {
  const [state, setState] = useState<EngineState>(load);

  useEffect(() => {
    localStorage.setItem(KEY, serialize(state));
  }, [state]);

  const track = useCallback((name: string) => {
    setState((s) => observe(s, { name, at: Date.now() }));
  }, []);

  const reveal = useCallback((intent: string): boolean => {
    const now = Date.now();
    if (!shouldReveal(state, intent, now)) return false;
    setState((s) => markRevealed(s, intent, now));
    return true;
  }, [state]);

  return { state, track, reveal };
}

// In a component:
// const { track, reveal } = useIntent();
// <button onClick={() => { track('pricing.viewed'); if (reveal('upgrade')) openOffer(); }}>
```
:::

## Vue

A composable with a `shallowRef` (the state is immutable, so deep reactivity is wasted) and a `watch` that persists.

```ts
import { onMounted, onUnmounted, shallowRef, watch } from 'vue';
import {
  createState, deserialize, endEpisode, markRevealed, observe, serialize, shouldReveal,
  type EngineState,
} from 'oracular';
import { config } from './intent-config';

const KEY = 'oracular';

export function useIntent() {
  const state = shallowRef<EngineState>(createState(config));

  onMounted(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      try { state.value = deserialize(saved, { config }); } catch { /* keep the fresh state */ }
    }
    window.addEventListener('pagehide', end);
  });
  onUnmounted(() => window.removeEventListener('pagehide', end));

  watch(state, (s) => localStorage.setItem(KEY, serialize(s)));

  function end() {
    state.value = endEpisode(state.value, Date.now());
  }
  function track(name: string) {
    state.value = observe(state.value, { name, at: Date.now() });
  }
  function reveal(intent: string): boolean {
    const now = Date.now();
    if (!shouldReveal(state.value, intent, now)) return false;
    state.value = markRevealed(state.value, intent, now);
    return true;
  }

  return { state, track, reveal };
}
```

## React Native

Three things differ from the web version, and all three come from a real integration:

- **Do not end the episode on backgrounding.** A twenty-second app switch would split a session: the signals seen so far would get a miss, and the outcome a minute later would have nothing to credit. Set `episodeTimeout` (30 minutes here) and let idle gaps close episodes; on background, only flush the pending save.
- **Queue events that arrive before the saved state has loaded.** `AsyncStorage` is asynchronous, and your first screens emit events immediately. Events observed before the load resolves are queued and applied once it has.
- **Debounce the save.** Serialize on every change but write a couple of seconds later, and flush at once when the app leaves the foreground.

The engine itself is plain ES2020 with no globals, so it runs unchanged on Hermes and through Metro, including Expo (verified with Expo SDK 57). No polyfills, no native module.

With `@oracular/react` all three come built in: `createIntentStore(config, { persist: asyncStorageAdapter('oracular', AsyncStorage) })` (or `mmkvAdapter(key, mmkv)`), `useIntent(store)` in screens, and `store.flush()` from an `AppState` listener when the app leaves `active`. The store queues events until the load resolves, debounces saves, and never ends an episode on its own. The same loop by hand:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createState, deserialize, type EngineState, type IntentEvent, markRevealed, observe,
  serialize, shouldReveal,
} from 'oracular';
import { config } from './intent-config'; // must set episodeTimeout, e.g. 30 * 60 * 1000

const KEY = 'oracular';
const SAVE_DELAY = 2_000;

export function useIntent() {
  const [, rerender] = useState(0);
  const stateRef = useRef<EngineState | null>(null); // source of truth; React re-renders from it
  const queue = useRef<IntentEvent[]>([]); // events seen before the load resolved
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (stateRef.current) void AsyncStorage.setItem(KEY, serialize(stateRef.current));
  }, []);

  const commit = useCallback((next: EngineState) => {
    stateRef.current = next;
    rerender((n) => n + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY); // debounced save
  }, [flush]);

  // Load with the config the app ships now, then drain the pre-load queue.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY).then((saved) => {
      if (cancelled) return;
      let s: EngineState;
      try {
        s = saved ? deserialize(saved, { config }) : createState(config);
      } catch {
        s = createState(config); // corrupt or incompatible: start fresh
      }
      for (const event of queue.current) s = observe(s, event);
      queue.current = [];
      commit(s);
    });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  // Background: flush the save. Do not endEpisode here; episodeTimeout closes idle sessions.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') flush();
    });
    return () => sub.remove();
  }, [flush]);

  const track = useCallback(
    (name: string) => {
      const event: IntentEvent = { name, at: Date.now() };
      if (!stateRef.current) {
        queue.current.push(event);
        return;
      }
      commit(observe(stateRef.current, event));
    },
    [commit],
  );

  const reveal = useCallback(
    (intent: string): boolean => {
      const s = stateRef.current;
      const now = Date.now();
      if (!s || !shouldReveal(s, intent, now)) return false;
      commit(markRevealed(s, intent, now));
      return true;
    },
    [commit],
  );

  return { ready: stateRef.current !== null, track, reveal };
}
```

The outcome is an ordinary event: `track('ride.started')` with the name you put in `outcome`.

### Trials on real devices

A dev-only panel (a debug screen that prints `explain` output) does not exist in standalone builds, and a trial on a real device is exactly where you want to see what the engine learned. Plan for an in-app export: a hidden gesture or settings row that opens the system Share sheet with `serialize(state)` and your own decision log (each `shouldReveal` that fired, when, and what you showed). That is enough to reproduce the user's state on a laptop with `deserialize` and read it with `explain` or the [Playground](/playground). On Android, `adb` access to the app's storage (`AsyncStorage` lives under the app's data directory) is the alternative when you can attach the device.

## Node

On a server, the "device" is the per-user record in your own store, and the clock is whatever timestamp the client sent. The library still does no I/O; you load, call, and save around it.

```ts
import {
  createState, deserialize, endEpisode, markRevealed, observe, serialize, shouldReveal,
  type EngineState,
} from 'oracular';
import { config } from './intent-config';
import { kv } from './your-kv-store'; // get(key): Promise<string | null>, set(key, value): Promise<void>

async function load(userId: string): Promise<EngineState> {
  const saved = await kv.get(`oracular:${userId}`);
  try {
    return saved ? deserialize(saved, { config }) : createState(config);
  } catch {
    return createState(config);
  }
}

async function save(userId: string, state: EngineState): Promise<void> {
  await kv.set(`oracular:${userId}`, serialize(state));
}

export async function handleEvent(userId: string, name: string, at: number): Promise<{ reveal: boolean }> {
  let state = await load(userId);
  state = observe(state, { name, at });
  const reveal = shouldReveal(state, 'upgrade', at);
  if (reveal) state = markRevealed(state, 'upgrade', at);
  await save(userId, state);
  return { reveal };
}

export async function handleSessionEnd(userId: string, at: number): Promise<void> {
  await save(userId, endEpisode(await load(userId), at));
}
```

Run the per-user sequence under a lock or a single writer; `observe` is pure, so two concurrent loads that both save would lose one update.

## Shipped wrappers

[`@oracular/react`](https://www.npmjs.com/package/@oracular/react) is the React binding, versioned on its own. A Vue composable will follow the same store (`createIntentStore` is framework-free); until then the Vue snippet above is the recommended shape.
