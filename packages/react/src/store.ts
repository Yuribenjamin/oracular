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
import { DEV } from './env';
import type { PersistAdapter } from './persist';

/** Which step of persistence failed: the read, the parse of what was read, a write, or a clear. */
export type PersistPhase = 'load' | 'parse' | 'save' | 'clear';

/**
 * Where the store stands with its adapter. `memory`: no adapter. `idle`: nothing read yet.
 * `loading`: a read is in flight. `loaded`: the read settled (or the key was empty, or `clear`
 * ran) and the store writes. `failed`: the read or its parse failed; the store keeps working in
 * memory and writes nothing until a later `load` succeeds or `clear` runs (a failed read is
 * retried by the next save, data that failed to parse only by `load`). `disposed`: no further
 * reads or writes.
 */
export type StoreStatus = 'memory' | 'idle' | 'loading' | 'loaded' | 'failed' | 'disposed';

export interface IntentStoreOptions {
  /** Where the state is loaded from and saved to. Without it the store lives in memory. */
  persist?: PersistAdapter;
  /** The clock that stamps events and reads. Default `Date.now`; inject one in tests. */
  now?: () => number;
  /** How long after a change the save runs, so a burst of events writes once. Default 250 ms. */
  saveDelay?: number;
  /**
   * Called when a read, the parse of what was read, a write or a clear fails; the store keeps
   * working from the state it has. Without it, a development build warns once per phase through
   * `console.warn`; pass `() => {}` to silence that.
   */
  onError?: (error: unknown, phase: PersistPhase) => void;
  /** Passed to `deserialize` for state versions newer than the library reads. */
  migrate?: Migrate;
}

/**
 * One engine state with a clock, subscribers and persistence around it. Framework-free: the React
 * hook reads it through `useSyncExternalStore`, and a Vue composable or plain code can read it the
 * same way. Every read and write goes to the current state, never to a render-time copy.
 *
 * Persistence never writes before the first read has settled, so an early flush (React's
 * StrictMode, a component unmounting at once, the app backgrounding at cold start) cannot write a
 * fresh state over the stored history.
 */
export interface IntentStore {
  /** The config the store was created with, as validated by the engine. */
  readonly config: EngineConfig;
  /** The current state. The same object until something changes, so it works as a snapshot. */
  getState(): EngineState;
  /** Where the store stands with its adapter; see {@link StoreStatus}. */
  getStatus(): StoreStatus;
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
   * true when the reveal happened, false when the gate or a cooldown said no. Before the first
   * read has settled it decides on the state in memory, not on the stored history.
   */
  reveal(intent: string, opts?: RevealOptions): boolean;
  /**
   * Reads the saved state through the adapter. Every caller gets the same promise while the read
   * is in flight, and a store that has loaded does not read again. Operations made before the
   * read settles are applied to the state in memory at once and replayed onto the loaded state
   * afterwards, so events from the first screens are never lost. A read that throws is reported
   * as `onError(error, 'load')`, leaves the store working in memory, blocks writes, and is retried
   * by the next `load`, `flush` or save. Stored data that cannot be parsed is reported once as
   * `'parse'` and blocks writes the same way, but saves do not read it again, since the same
   * bytes would fail the same way: only `load` reads again, and reports only if the stored data
   * changed; `clear` is the explicit way to start over. Never rejects on its own; a subscriber
   * that throws when the loaded state is announced rejects it.
   */
  load(): Promise<void>;
  /**
   * Cancels the pending debounced save and writes now, if anything changed since the last write.
   * A flush before the first read has settled waits for the read, then writes only if the state
   * differs from what was read.
   */
  flush(): Promise<void>;
  /**
   * Starts over: a fresh state in memory, the stored one removed (an adapter without `remove` has
   * the fresh state written over it instead), and writes allowed again. For "forget me", a
   * sign-out or an account switch; also the way out after a failed read.
   */
  clear(): Promise<void>;
  /**
   * Stops persistence for good: cancels the pending save and ignores later reads and writes.
   * Resolves once no write is in flight, so `await store.dispose()` before wiping the storage
   * yourself is safe. It does not write first; call `flush` before it to keep the last state.
   * In-memory operations and subscriptions keep working.
   */
  dispose(): Promise<void>;
}

type Op = (s: EngineState) => EngineState;

/** Most operations kept for replay onto a state that is still loading; past it the oldest go. */
const MAX_QUEUE = 1000;

function warnOnce(): (error: unknown, phase: PersistPhase) => void {
  const warned = new Set<PersistPhase>();
  return (error, phase) => {
    if (!DEV || warned.has(phase)) return;
    warned.add(phase);
    console.warn(
      `@oracular/react: the ${phase} failed; the store keeps working from the state it has. Pass onError to handle it.`,
      error,
    );
  };
}

export function createIntentStore(
  config: EngineConfig,
  opts: IntentStoreOptions = {},
): IntentStore {
  const persist = opts.persist;
  const now = opts.now ?? Date.now;
  const saveDelay = opts.saveDelay ?? 250;
  const onError = opts.onError ?? warnOnce();
  let state = createState(config);
  /** What a fresh state serializes to. An empty key holds the same, so it counts as saved. */
  const freshJson = serialize(state);
  const listeners = new Set<() => void>();
  let status: StoreStatus = persist === undefined ? 'memory' : 'idle';
  /** The read in flight, shared by everyone who waits for it. */
  let loading: Promise<void> | null = null;
  /**
   * Operations applied since creation, replayed in order onto the loaded state. Kept across a
   * failed read, dropped once a read succeeds or `clear` runs.
   */
  let queue: Op[] | null = persist === undefined ? null : [];
  let warnedQueue = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The last string written, so a save after a load or a no-op change writes nothing. */
  let lastSaved: string | null = null;
  /** Stored data that failed to parse: saves do not read it again, and a `load` that finds it unchanged reports nothing new. */
  let badJson: string | null = null;
  /** The write in flight: one at a time, so writes land in order. */
  let writing: Promise<void> | null = null;
  /** Bumped by `clear` and `dispose`; a read or write from an earlier generation is discarded. */
  let generation = 0;

  const notify = (): void => {
    let failure: { error: unknown } | null = null;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        if (failure === null) failure = { error };
      }
    }
    if (failure !== null) throw failure.error;
  };

  const write = (): Promise<void> => {
    if (persist === undefined || status !== 'loaded') return Promise.resolve();
    const json = serialize(state);
    if (json === lastSaved) return writing ?? Promise.resolve();
    const gen = generation;
    if (writing !== null) {
      // One write at a time: after the current one lands, write whatever the state is by then.
      return writing.then(() => (gen === generation ? write() : undefined));
    }
    let result: void | Promise<void>;
    try {
      result = persist.save(json);
    } catch (error) {
      onError(error, 'save');
      return Promise.resolve();
    }
    if (result === undefined) {
      // A synchronous adapter has written: nothing to wait for.
      if (gen === generation) lastSaved = json;
      return Promise.resolve();
    }
    const done: Promise<void> = Promise.resolve(result)
      .then(
        () => {
          if (gen === generation) lastSaved = json;
        },
        (error) => {
          onError(error, 'save');
        },
      )
      .finally(() => {
        if (writing === done) writing = null;
      });
    writing = done;
    return done;
  };

  const save = (): Promise<void> => {
    if (persist === undefined || status === 'disposed') return Promise.resolve();
    if (status === 'loaded') return write();
    // Data that failed to parse fails the same way on every read: nothing is written until a
    // `load` finds it changed or `clear` runs.
    if (status === 'failed' && badJson !== null) return Promise.resolve();
    // Never before the first read has settled: wait for it (starting it if nothing did), then
    // write only if it succeeded.
    const gen = generation;
    return load().then(() => (gen === generation ? write() : undefined));
  };

  const schedule = (): void => {
    if (persist === undefined || status === 'disposed') return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, saveDelay);
  };

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return save();
  };

  const apply = (op: Op): EngineState => {
    const prev = state;
    const next = op(prev);
    // Queued regardless of effect: an endEpisode that found nothing open here may close the
    // episode the saved state holds.
    if (queue !== null) {
      if (queue.length >= MAX_QUEUE) {
        queue.shift();
        if (DEV && !warnedQueue) {
          warnedQueue = true;
          console.warn(
            `@oracular/react: more than ${MAX_QUEUE} operations before the stored state loaded; the oldest will not be replayed onto it`,
          );
        }
      }
      queue.push(op);
    }
    if (next === prev) return next;
    state = next;
    // Persistence first, so a subscriber that throws cannot skip the save.
    if (episodeClosed(prev, next)) void flush();
    else schedule();
    notify();
    return next;
  };

  const load = (): Promise<void> => {
    if (persist === undefined || status === 'loaded' || status === 'disposed') {
      return Promise.resolve();
    }
    if (loading !== null) return loading;
    const gen = generation;
    status = 'loading';
    const attempt = (async (): Promise<void> => {
      let json: string | null;
      try {
        json = await persist.load();
      } catch (error) {
        if (gen === generation) status = 'failed';
        onError(error, 'load');
        return;
      }
      if (gen !== generation) return;
      if (json === null) {
        // Nothing stored: the state in memory is the truth. An empty key holds what a fresh state
        // holds, so a flush with nothing tracked writes nothing; the first change writes.
        status = 'loaded';
        queue = null;
        badJson = null;
        lastSaved = freshJson;
        return;
      }
      if (json === badJson) {
        // The same bytes that failed to parse before: nothing new to report.
        status = 'failed';
        return;
      }
      let next: EngineState;
      try {
        next = deserialize(
          json,
          opts.migrate === undefined ? { config } : { config, migrate: opts.migrate },
        );
      } catch (error) {
        status = 'failed';
        badJson = json;
        onError(error, 'parse');
        return;
      }
      badJson = null;
      for (const op of queue ?? []) next = op(next);
      state = next;
      status = 'loaded';
      queue = null;
      // Storage still holds `json`: nothing could write while the read was in flight.
      if (serialize(next) === json) lastSaved = json;
      else schedule();
      notify();
    })();
    const done: Promise<void> = attempt.finally(() => {
      if (loading === done) loading = null;
    });
    loading = done;
    return done;
  };

  const clear = (): Promise<void> => {
    if (status === 'disposed') return Promise.resolve();
    generation++;
    const gen = generation;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const fresh = createState(config);
    state = fresh;
    queue = null;
    lastSaved = null;
    badJson = null;
    status = 'loaded';
    let result: Promise<void> = Promise.resolve();
    if (persist !== undefined) {
      const adapter = persist;
      // After the write in flight, so nothing lands on the key after it was removed.
      const done: Promise<void> = (writing ?? Promise.resolve())
        .then(async () => {
          if (gen !== generation) return;
          try {
            if (adapter.remove !== undefined) {
              await adapter.remove();
              // The key is empty, which holds what the fresh state holds.
              if (gen === generation) lastSaved = freshJson;
            } else {
              const json = serialize(fresh);
              await adapter.save(json);
              if (gen === generation) lastSaved = json;
            }
          } catch (error) {
            onError(error, 'clear');
          }
        })
        .finally(() => {
          if (writing === done) writing = null;
        });
      writing = done;
      result = done;
    }
    notify();
    return result;
  };

  const dispose = (): Promise<void> => {
    if (status !== 'disposed') {
      generation++;
      status = 'disposed';
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      queue = null;
    }
    return writing ?? Promise.resolve();
  };

  const store: IntentStore = {
    config: state.config,
    getState: () => state,
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now,
    track: (name, props) => {
      // Stamped now, not when replayed onto a loaded state.
      const event: IntentEvent =
        props === undefined ? { name, at: now() } : { name, at: now(), props };
      return apply((s) => observe(s, event));
    },
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
    clear,
    dispose,
  };
  return store;
}
