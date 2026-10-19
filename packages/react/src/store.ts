import {
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode as endEpisodeAt,
  episodeClosed,
  type IntentEvent,
  type Migrate,
  markRevealed as markRevealedAt,
  observe,
  type RevealOptions,
  serialize,
  shouldReveal,
} from 'oracular';
import type { PersistAdapter } from './persist';

export interface IntentStoreOptions {
  /** Where the state is loaded from and saved to. Without it the store lives in memory. */
  persist?: PersistAdapter;
  /** The clock that stamps events and reads. Default `Date.now`; inject one in tests. */
  now?: () => number;
  /** How long after a change the save runs, so a burst of events writes once. Default 250 ms. */
  saveDelay?: number;
  /** Called when a load or a save fails. The store keeps working from the state it has. */
  onError?: (error: unknown, phase: 'load' | 'save') => void;
  /** Passed to `deserialize` for state versions newer than the library reads. */
  migrate?: Migrate;
}

/**
 * One engine state with a clock, subscribers and persistence around it. Framework-free: the React
 * hook reads it through `useSyncExternalStore`, and a Vue composable or plain code can read it the
 * same way. Every read and write goes to the current state, never to a render-time copy.
 */
export interface IntentStore {
  /** The config the store was created with, as validated by the engine. */
  readonly config: EngineConfig;
  /** The current state. The same object until something changes, so it works as a snapshot. */
  getState(): EngineState;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** The store's clock. */
  now(): number;
  /** `observe` with the event stamped by the store's clock. */
  track(name: string, props?: Record<string, unknown>): EngineState;
  /** `observe` with an event you stamped yourself. */
  observe(event: IntentEvent): EngineState;
  /** `endEpisode` at `at`, default now. Call it on sign-out, never on a background switch. */
  endEpisode(at?: number): EngineState;
  /** `markRevealed` at `at`, default now. */
  markRevealed(intent: string, at?: number): EngineState;
  /**
   * `shouldReveal` and `markRevealed` as one step against the current state, at the clock's now:
   * true when the reveal happened, false when the gate or a cooldown said no.
   */
  reveal(intent: string, opts?: RevealOptions): boolean;
  /**
   * Loads the saved state through the adapter, once. Operations made while the load is pending
   * are applied to the state in memory at once and replayed onto the loaded state afterwards, so
   * events from the first screens are never lost. A failed or empty load keeps the current state.
   */
  load(): Promise<void>;
  /** Cancels the pending debounced save and writes now, if anything changed since the last write. */
  flush(): Promise<void>;
}

const noop = (): void => {};

export function createIntentStore(
  config: EngineConfig,
  opts: IntentStoreOptions = {},
): IntentStore {
  const persist = opts.persist;
  const now = opts.now ?? Date.now;
  const saveDelay = opts.saveDelay ?? 250;
  const onError = opts.onError ?? noop;
  let state = createState(config);
  const listeners = new Set<() => void>();
  /** Operations applied while the load is pending, replayed onto the loaded state in order. */
  let replay: ((s: EngineState) => EngineState)[] | null = null;
  let loadStarted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The last string written, so a save after a load or a no-op change writes nothing. */
  let lastSaved: string | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const save = async (): Promise<void> => {
    if (persist === undefined) return;
    const json = serialize(state);
    if (json === lastSaved) return;
    try {
      await persist.save(json);
      lastSaved = json;
    } catch (error) {
      onError(error, 'save');
    }
  };

  const schedule = (): void => {
    if (persist === undefined) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, saveDelay);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await save();
  };

  const apply = (op: (s: EngineState) => EngineState): EngineState => {
    const prev = state;
    const next = op(prev);
    // Queued regardless of effect: an endEpisode that found nothing open here may close the
    // episode the saved state holds.
    if (replay !== null) replay.push(op);
    if (next === prev) return next;
    state = next;
    notify();
    if (episodeClosed(prev, next)) void flush();
    else schedule();
    return next;
  };

  const load = async (): Promise<void> => {
    if (persist === undefined || loadStarted) return;
    loadStarted = true;
    replay = [];
    try {
      const json = await persist.load();
      if (json !== null) {
        let next = deserialize(
          json,
          opts.migrate === undefined ? { config } : { config, migrate: opts.migrate },
        );
        for (const op of replay) next = op(next);
        state = next;
        notify();
        const again = serialize(next);
        if (again === json) lastSaved = json;
        else schedule();
      }
    } catch (error) {
      onError(error, 'load');
    } finally {
      replay = null;
    }
  };

  const store: IntentStore = {
    config: state.config,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now,
    track: (name, props) =>
      apply((s) =>
        observe(s, props === undefined ? { name, at: now() } : { name, at: now(), props }),
      ),
    observe: (event) => apply((s) => observe(s, event)),
    endEpisode: (at = now()) => apply((s) => endEpisodeAt(s, at)),
    markRevealed: (intent, at = now()) => apply((s) => markRevealedAt(s, intent, at)),
    reveal: (intent, revealOpts) => {
      const at = now();
      if (!shouldReveal(state, intent, at, revealOpts)) return false;
      apply((s) => markRevealedAt(s, intent, at));
      return true;
    },
    load,
    flush,
  };
  return store;
}
