import { createState, observe, STATE_VERSION, serialize } from 'oracular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInvariants, DAY, MINUTE, upgradeConfig } from '../../../tests/helpers';
import { createIntentStore, type PersistAdapter, type PersistPhase } from '../src';
import { clock, deferredAdapter, fakeAdapter, microtasks, slowSaveAdapter, T } from './adapters';

/** One signal of weight 5 on a weak prior opens the gate at once; the cooldown is the day-long half-life. */
const thin = {
  intents: {
    tip: { prior: 0.5, priorStrength: 2, halfLife: DAY, signals: { s: 5 }, saturate: false },
  },
};

const config = upgradeConfig();
/** A state with one day-old `pricing.viewed`: the history a previous session left behind. */
const saved = serialize(observe(createState(config), { name: 'pricing.viewed', at: T - DAY }));

function recorder() {
  const phases: PersistPhase[] = [];
  const errors: unknown[] = [];
  return {
    phases,
    errors,
    onError: (error: unknown, phase: PersistPhase) => {
      phases.push(phase);
      errors.push(error);
    },
  };
}

describe('createIntentStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tracks with the injected clock, notifies subscribers, and every state holds the invariants', () => {
    const c = clock();
    const store = createIntentStore(upgradeConfig({ episodeTimeout: 30 * MINUTE }), { now: c.now });
    assertInvariants(store.getState());
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getState().episode.lastEventAt as number);
    });
    store.track('pricing.viewed');
    c.advance(MINUTE);
    store.track('limit.hit', { plan: 'pro' });
    assertInvariants(store.getState());
    expect(seen).toStrictEqual([T, T + MINUTE]);
    expect(store.getState().episode.intents.upgrade?.seen).toStrictEqual([
      'pricing.viewed',
      'limit.hit',
    ]);
    expect(store.now()).toBe(T + MINUTE);
    unsubscribe();
    store.track('export.clicked');
    expect(seen).toHaveLength(2);
  });

  it('is a no-op notification-wise when the engine returns the same state', () => {
    const store = createIntentStore(config, { now: () => T });
    let calls = 0;
    store.subscribe(() => {
      calls++;
    });
    store.endEpisode(); // nothing open: the engine returns the same object
    expect(calls).toBe(0);
  });

  it('debounces saves: a burst writes once after the delay, flush writes now, and nothing new writes nothing', async () => {
    const { adapter, writes } = fakeAdapter();
    const c = clock();
    const store = createIntentStore(config, { persist: adapter, now: c.now, saveDelay: 250 });
    await store.load();
    store.track('pricing.viewed');
    store.track('limit.hit');
    store.track('export.clicked');
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] as string).version).toBe(STATE_VERSION);
    expect(writes[0]).toBe(serialize(store.getState()));
    c.advance(MINUTE);
    store.track('pricing.viewed');
    await store.flush();
    expect(writes).toHaveLength(2);
    await store.flush();
    expect(writes).toHaveLength(2);
  });

  it('an empty key counts as saved: a flush with nothing tracked writes nothing, the first event writes', async () => {
    const { adapter, writes } = fakeAdapter();
    const store = createIntentStore(config, { persist: adapter, now: () => T });
    await store.load();
    expect(store.getStatus()).toBe('loaded');
    await store.flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(0);
    store.track('pricing.viewed');
    await store.flush();
    expect(writes).toStrictEqual([serialize(store.getState())]);
  });

  it('an adapter whose load returns undefined counts as an empty key, as one returning null does', async () => {
    const writes: string[] = [];
    const store = createIntentStore(config, {
      // Written in JavaScript, without the `?? null` the shipped adapters have.
      persist: { load: () => undefined as unknown as null, save: (json) => void writes.push(json) },
      now: () => T,
    });
    await store.load();
    expect(store.getStatus()).toBe('loaded');
    await store.flush();
    expect(writes).toHaveLength(0);
    store.track('pricing.viewed');
    await store.flush();
    expect(writes).toStrictEqual([serialize(store.getState())]);
  });

  it("getInitialState is the fresh state, the same object for the store's life", async () => {
    const { adapter } = fakeAdapter(saved, true);
    const store = createIntentStore(config, { persist: adapter, now: () => T });
    const initial = store.getInitialState();
    expect(initial).toStrictEqual(createState(config));
    expect(store.getState()).toBe(initial);
    await store.load();
    expect(store.getState()).not.toBe(initial);
    expect(store.getInitialState()).toBe(initial);
    store.track('limit.hit');
    await store.clear();
    expect(store.getInitialState()).toBe(initial);
    expect(store.getState()).toStrictEqual(initial);
  });

  it('writes at once when an episode closes, explicitly or by timeout', async () => {
    const { adapter, writes } = fakeAdapter();
    const c = clock();
    const store = createIntentStore(upgradeConfig({ episodeTimeout: 30 * MINUTE }), {
      persist: adapter,
      now: c.now,
    });
    await store.load();
    store.track('pricing.viewed');
    c.advance(MINUTE);
    store.endEpisode();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] as string).episode.startedAt).toBeNull();
    c.advance(MINUTE);
    store.track('limit.hit');
    c.advance(2 * 60 * MINUTE);
    store.track('export.clicked'); // closes the idle episode first, then opens a new one
    expect(writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(2); // the flush covered the change; nothing pending
  });

  it('loads the saved state, replays what happened meanwhile, and saves the merged result', async () => {
    const writes: string[] = [];
    const slow: PersistAdapter = {
      load: () => new Promise((resolve) => setTimeout(() => resolve(saved), 10)),
      save: (json) => {
        writes.push(json);
      },
    };
    const c = clock();
    const store = createIntentStore(config, { persist: slow, now: c.now });
    const loading = store.load();
    store.track('limit.hit'); // before the load resolves
    expect(store.getState().intents.upgrade?.contributions['limit.hit']).toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    await loading;
    const s = store.getState();
    assertInvariants(s);
    expect(s.intents.upgrade?.contributions['pricing.viewed']).toBeDefined(); // from the saved state
    expect(s.intents.upgrade?.contributions['limit.hit']).toBeDefined(); // replayed onto it
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(serialize(s));
  });

  it('after a load with nothing tracked meanwhile, writes nothing: the round trip is byte for byte', async () => {
    const { adapter, writes } = fakeAdapter(saved);
    const store = createIntentStore(config, { persist: adapter, now: () => T });
    await store.load();
    expect(serialize(store.getState())).toBe(saved);
    await vi.advanceTimersByTimeAsync(1000);
    await store.flush();
    expect(writes).toHaveLength(0);
  });

  describe('never writes before the first read has settled', () => {
    it('a flush during a pending read waits for it and writes only the merged state', async () => {
      const d = deferredAdapter(saved);
      const store = createIntentStore(config, { persist: d.adapter, now: () => T });
      const loading = store.load();
      store.track('limit.hit');
      const flushed = store.flush();
      await microtasks();
      expect(d.writes).toHaveLength(0);
      d.resolveLoad();
      await Promise.all([loading, flushed]);
      const s = store.getState();
      expect(s.intents.upgrade?.contributions['pricing.viewed']).toBeDefined();
      expect(s.intents.upgrade?.contributions['limit.hit']).toBeDefined();
      expect(d.writes).toStrictEqual([serialize(s)]);
      expect(store.getStatus()).toBe('loaded');
    });

    it('a debounced save that falls due before a slow read completes waits for the read', async () => {
      const d = deferredAdapter(saved);
      const store = createIntentStore(config, { persist: d.adapter, now: () => T, saveDelay: 250 });
      void store.load();
      store.track('limit.hit');
      await vi.advanceTimersByTimeAsync(300);
      expect(d.writes).toHaveLength(0);
      d.resolveLoad();
      await microtasks();
      expect(d.writes).toHaveLength(1);
      expect(JSON.parse(d.writes[0] as string).intents.upgrade.contributions).toHaveProperty(
        'pricing.viewed',
      );
    });

    it('an episode close during a pending read does not write before it', async () => {
      const d = deferredAdapter(saved);
      const store = createIntentStore(upgradeConfig({ episodeTimeout: 30 * MINUTE }), {
        persist: d.adapter,
        now: () => T,
      });
      void store.load();
      store.track('limit.hit');
      store.endEpisode();
      await microtasks();
      expect(d.writes).toHaveLength(0);
      d.resolveLoad();
      await microtasks();
      expect(d.writes).toHaveLength(1);
      expect(JSON.parse(d.writes[0] as string).episode.startedAt).toBeNull();
      expect(store.getState().intents.upgrade?.learned['pricing.viewed']).toBeDefined(); // the miss landed on the loaded history
    });

    it('with a synchronous adapter, a load then an immediate flush writes nothing and leaves the stored string alone', async () => {
      const f = fakeAdapter(saved);
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      const loading = store.load();
      const flushed = store.flush();
      await Promise.all([loading, flushed]);
      expect(f.writes).toHaveLength(0);
      expect(f.stored()).toBe(saved);
      expect(serialize(store.getState())).toBe(saved);
    });

    it('events tracked before load() is called survive the load', async () => {
      const f = fakeAdapter(saved);
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      store.track('limit.hit'); // a child effect, before the parent's hook loads
      await store.load();
      const s = store.getState();
      expect(s.intents.upgrade?.contributions['pricing.viewed']).toBeDefined();
      expect(s.intents.upgrade?.contributions['limit.hit']).toBeDefined();
      await vi.advanceTimersByTimeAsync(250);
      expect(f.writes).toStrictEqual([serialize(s)]);
    });

    it('events replayed onto the loaded state keep the time they were tracked at', async () => {
      const d = deferredAdapter(saved);
      const c = clock();
      const store = createIntentStore(config, { persist: d.adapter, now: c.now });
      const loading = store.load();
      store.track('limit.hit'); // at T
      c.advance(MINUTE);
      d.resolveLoad();
      await loading;
      expect(store.getState().episode.lastEventAt).toBe(T);
    });

    it('a save with no load ever started reads first and merges the stored history', async () => {
      const f = fakeAdapter(saved);
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      store.track('limit.hit');
      await store.flush();
      expect(f.reads()).toBe(1);
      expect(f.writes).toHaveLength(1);
      const written = JSON.parse(f.writes[0] as string);
      expect(written.intents.upgrade.contributions).toHaveProperty('pricing.viewed');
      expect(written.intents.upgrade.contributions).toHaveProperty('limit.hit');
    });
  });

  describe('a failed read', () => {
    it('blocks every write, is reported as load with the adapter error, and the next save retries with everything tracked since', async () => {
      const d = deferredAdapter(saved);
      const r = recorder();
      const store = createIntentStore(config, {
        persist: d.adapter,
        now: () => T,
        onError: r.onError,
      });
      const first = store.load();
      store.track('limit.hit');
      const busy = new Error('busy');
      d.rejectLoad(busy);
      await first;
      expect(store.getStatus()).toBe('failed');
      expect(r.phases).toStrictEqual(['load']);
      expect(r.errors[0]).toBe(busy);
      expect(store.getState()).not.toStrictEqual(createState(config)); // keeps working in memory

      const flushed = store.flush(); // retries the read instead of writing
      await microtasks();
      expect(d.reads()).toBe(2);
      expect(d.writes).toHaveLength(0);
      d.resolveLoad();
      await flushed;
      const s = store.getState();
      expect(store.getStatus()).toBe('loaded');
      expect(s.intents.upgrade?.contributions['pricing.viewed']).toBeDefined();
      expect(s.intents.upgrade?.contributions['limit.hit']).toBeDefined();
      expect(d.writes).toStrictEqual([serialize(s)]);
    });

    it('the debounced save and an episode close retry the read too, and write nothing while it fails', async () => {
      const d = deferredAdapter(saved);
      const r = recorder();
      const store = createIntentStore(upgradeConfig({ episodeTimeout: 30 * MINUTE }), {
        persist: d.adapter,
        now: () => T,
        onError: r.onError,
      });
      void store.load();
      d.rejectLoad(new Error('busy'));
      await microtasks();
      store.track('pricing.viewed');
      await vi.advanceTimersByTimeAsync(250);
      d.rejectLoad(new Error('busy'));
      await microtasks();
      store.endEpisode();
      await microtasks();
      d.rejectLoad(new Error('busy'));
      await microtasks();
      expect(d.reads()).toBe(3);
      expect(d.writes).toHaveLength(0);
      expect(r.phases).toStrictEqual(['load', 'load', 'load']);
    });

    it('stored data that cannot be parsed is reported as parse once, blocks writes, and is not read again by saves', async () => {
      let stored: string | null = '{"version":';
      let reads = 0;
      const writes: string[] = [];
      const adapter: PersistAdapter = {
        load: () => {
          reads++;
          return stored;
        },
        save: (json) => {
          writes.push(json);
        },
      };
      const r = recorder();
      const store = createIntentStore(config, {
        persist: adapter,
        now: () => T,
        onError: r.onError,
      });
      await store.load();
      expect(store.getStatus()).toBe('failed');
      expect(r.phases).toStrictEqual(['parse']);
      expect(r.errors[0]).toBeInstanceOf(SyntaxError);
      // The same bytes would fail the same way: saves neither read nor write.
      store.track('pricing.viewed');
      await store.flush();
      await vi.advanceTimersByTimeAsync(250);
      store.endEpisode();
      await microtasks();
      expect(reads).toBe(1);
      expect(writes).toHaveLength(0);
      expect(r.phases).toStrictEqual(['parse']);
      // An explicit load reads again, and reports nothing new while the data is unchanged.
      await store.load();
      expect(reads).toBe(2);
      expect(r.phases).toStrictEqual(['parse']);
      expect(store.getStatus()).toBe('failed');
      // Once the stored data changes, the load parses it and replays everything tracked meanwhile.
      stored = saved;
      await store.load();
      expect(reads).toBe(3);
      expect(store.getStatus()).toBe('loaded');
      expect(store.getState().intents.upgrade?.contributions).toHaveProperty('pricing.viewed');
      expect(store.getState().episode.startedAt).toBeNull(); // the replayed endEpisode closed it
      await vi.advanceTimersByTimeAsync(250);
      expect(writes).toStrictEqual([serialize(store.getState())]);
    });

    it('clear is the way out of a parse failure', async () => {
      const f = fakeAdapter('{"version":');
      const r = recorder();
      const store = createIntentStore(config, {
        persist: f.adapter,
        now: () => T,
        onError: r.onError,
      });
      await store.load();
      expect(store.getStatus()).toBe('failed');
      store.track('pricing.viewed');
      await store.flush();
      expect(f.writes).toHaveLength(0);
      expect(r.phases).toStrictEqual(['parse']);

      await store.clear();
      expect(store.getStatus()).toBe('loaded');
      expect(store.getState()).toStrictEqual(createState(config));
      // No `remove` on this adapter: the fresh state is written over the unreadable one.
      expect(f.writes).toStrictEqual([serialize(createState(config))]);
      store.track('pricing.viewed');
      await vi.advanceTimersByTimeAsync(250);
      expect(f.writes).toHaveLength(2);
    });

    it('a failing save is reported as save and leaves the next flush to retry it', async () => {
      const r = recorder();
      let fail = true;
      const writes: string[] = [];
      const store = createIntentStore(config, {
        persist: {
          load: () => null,
          save: (json) => {
            if (fail) throw new Error('quota');
            writes.push(json);
          },
        },
        onError: r.onError,
        now: () => T,
      });
      store.track('pricing.viewed');
      await store.flush();
      expect(r.phases).toStrictEqual(['save']);
      fail = false;
      await store.flush();
      expect(writes).toStrictEqual([serialize(store.getState())]);
    });
  });

  describe('subscribers', () => {
    it('a throwing subscriber does not stop later subscribers or the save, and is rethrown once', async () => {
      const f = fakeAdapter();
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      await store.load();
      let later = 0;
      store.subscribe(() => {
        throw new Error('boom');
      });
      store.subscribe(() => {
        later++;
      });
      expect(() => store.track('pricing.viewed')).toThrow('boom');
      expect(later).toBe(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(f.writes).toStrictEqual([serialize(store.getState())]);
    });

    it('a subscriber throwing when the loaded state is announced rejects load, is not reported as a load error, and the merged state is still saved', async () => {
      const d = deferredAdapter(saved);
      const r = recorder();
      const store = createIntentStore(config, {
        persist: d.adapter,
        now: () => T,
        onError: r.onError,
      });
      store.subscribe(() => {
        throw new Error('boom');
      });
      const loading = store.load();
      expect(() => store.track('limit.hit')).toThrow('boom');
      d.resolveLoad();
      await expect(loading).rejects.toThrow('boom');
      expect(r.phases).toStrictEqual([]);
      expect(store.getStatus()).toBe('loaded');
      await vi.advanceTimersByTimeAsync(250);
      expect(d.writes).toStrictEqual([serialize(store.getState())]);
      expect(store.getState().intents.upgrade?.contributions['pricing.viewed']).toBeDefined();
    });

    it('unsubscribing inside a listener takes effect from the next notification', () => {
      const store = createIntentStore(config, { now: () => T });
      const calls: string[] = [];
      const second = store.subscribe(() => {
        calls.push('second');
      });
      store.subscribe(() => {
        calls.push('first');
        second();
      });
      store.track('pricing.viewed');
      store.track('limit.hit');
      expect(calls).toStrictEqual(['second', 'first', 'first']);
    });
  });

  describe('lifecycle', () => {
    it('dispose cancels the pending save, blocks later writes and reads, and the store keeps working in memory', async () => {
      const f = fakeAdapter();
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      await store.load();
      store.track('pricing.viewed');
      await store.dispose();
      expect(store.getStatus()).toBe('disposed');
      await vi.advanceTimersByTimeAsync(250);
      expect(f.writes).toHaveLength(0);
      let notified = 0;
      store.subscribe(() => {
        notified++;
      });
      store.track('limit.hit');
      expect(notified).toBe(1);
      expect(store.getState().intents.upgrade?.contributions['limit.hit']).toBeDefined();
      await store.flush();
      await store.load();
      expect(f.writes).toHaveLength(0);
      expect(f.reads()).toBe(1);
      await store.dispose(); // idempotent
    });

    it('dispose resolves once the write in flight has landed', async () => {
      const s = slowSaveAdapter();
      const store = createIntentStore(config, { persist: s.adapter, now: () => T });
      await store.load();
      store.track('pricing.viewed');
      void store.flush();
      expect(s.pending).toHaveLength(1);
      let done = false;
      const disposed = store.dispose().then(() => {
        done = true;
      });
      await microtasks();
      expect(done).toBe(false);
      s.settle();
      await disposed;
      expect(done).toBe(true);
      expect(s.landed).toHaveLength(1);
    });

    it('clear removes the stored key, resets the state, notifies, allows writes again, and a later change writes a fresh history', async () => {
      const f = fakeAdapter(saved, true);
      const store = createIntentStore(config, { persist: f.adapter, now: () => T });
      await store.load();
      let notified = 0;
      store.subscribe(() => {
        notified++;
      });
      await store.clear();
      expect(f.removes()).toBe(1);
      expect(f.stored()).toBeNull();
      expect(f.writes).toHaveLength(0);
      expect(store.getState()).toStrictEqual(createState(config));
      expect(notified).toBe(1);
      expect(store.getStatus()).toBe('loaded');
      await store.flush(); // the empty key already holds what the fresh state holds
      expect(f.writes).toHaveLength(0);
      store.track('pricing.viewed');
      await vi.advanceTimersByTimeAsync(250);
      expect(f.writes).toStrictEqual([serialize(store.getState())]);
      expect(JSON.parse(f.writes[0] as string).intents.upgrade.contributions).not.toHaveProperty(
        'limit.hit',
      );
    });

    it('clear during a pending read discards the late result', async () => {
      const d = deferredAdapter(saved);
      const store = createIntentStore(config, { persist: d.adapter, now: () => T });
      const loading = store.load();
      const cleared = store.clear();
      d.resolveLoad();
      await Promise.all([loading, cleared]);
      expect(store.getState()).toStrictEqual(createState(config));
      expect(d.writes).toStrictEqual([serialize(createState(config))]); // no `remove`: fresh state written instead
      expect(store.getStatus()).toBe('loaded');
    });

    it('clear waits for the write in flight, so nothing lands on the key after it was removed', async () => {
      const removes: number[] = [];
      const pending: { json: string; resolve: () => void }[] = [];
      const order: string[] = [];
      const adapter: PersistAdapter = {
        load: () => null,
        save: (json) =>
          new Promise<void>((resolve) => {
            pending.push({ json, resolve });
          }),
        remove: () => {
          removes.push(pending.length);
          order.push('remove');
        },
      };
      const store = createIntentStore(config, { persist: adapter, now: () => T });
      await store.load();
      store.track('pricing.viewed');
      void store.flush();
      const cleared = store.clear();
      await microtasks();
      expect(order).toStrictEqual([]);
      const write = pending.shift();
      order.push('save');
      write?.resolve();
      await cleared;
      expect(order).toStrictEqual(['save', 'remove']);
    });

    it('a failing remove is reported as clear, and the store still starts over', async () => {
      const r = recorder();
      const store = createIntentStore(config, {
        persist: {
          load: () => saved,
          save: () => {},
          remove: () => {
            throw new Error('locked');
          },
        },
        onError: r.onError,
        now: () => T,
      });
      await store.load();
      await store.clear();
      expect(r.phases).toStrictEqual(['clear']);
      expect(store.getState()).toStrictEqual(createState(config));
      expect(store.getStatus()).toBe('loaded');
    });

    it('overlapping saves run one at a time and the last write holds the latest state', async () => {
      const s = slowSaveAdapter();
      const c = clock();
      const store = createIntentStore(config, { persist: s.adapter, now: c.now });
      await store.load();
      store.track('pricing.viewed');
      const first = store.flush();
      c.advance(MINUTE);
      store.track('limit.hit');
      const second = store.flush();
      expect(s.pending).toHaveLength(1); // one write in flight
      s.settle();
      await microtasks();
      expect(s.pending).toHaveLength(1); // the next one starts after it, with the state as it is now
      s.settle();
      await Promise.all([first, second]);
      expect(s.landed).toHaveLength(2);
      expect(s.stored()).toBe(serialize(store.getState()));
    });

    it('two loads while the first is pending share one promise and one read; a load after success does not read', async () => {
      const d = deferredAdapter(saved);
      const store = createIntentStore(config, { persist: d.adapter, now: () => T });
      const a = store.load();
      const b = store.load();
      expect(a).toBe(b);
      expect(store.getStatus()).toBe('loading');
      d.resolveLoad();
      await a;
      expect(d.reads()).toBe(1);
      await store.load();
      expect(d.reads()).toBe(1);
    });

    it('getStatus walks memory, idle, loading, loaded, failed and disposed', async () => {
      expect(createIntentStore(config).getStatus()).toBe('memory');
      const d = deferredAdapter();
      const store = createIntentStore(config, {
        persist: d.adapter,
        now: () => T,
        onError: () => {},
      });
      expect(store.getStatus()).toBe('idle');
      const loading = store.load();
      expect(store.getStatus()).toBe('loading');
      d.resolveLoad();
      await loading;
      expect(store.getStatus()).toBe('loaded');

      const failing = deferredAdapter();
      const other = createIntentStore(config, {
        persist: failing.adapter,
        now: () => T,
        onError: () => {},
      });
      const attempt = other.load();
      failing.rejectLoad(new Error('busy'));
      await attempt;
      expect(other.getStatus()).toBe('failed');
      await other.dispose();
      expect(other.getStatus()).toBe('disposed');
    });

    it('keeps at most 1000 operations for replay and warns once when it drops the oldest', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const d = deferredAdapter(saved);
      const c = clock();
      const store = createIntentStore(config, { persist: d.adapter, now: c.now });
      const loading = store.load();
      store.track('limit.hit'); // the oldest: dropped
      for (let i = 0; i < 1000; i++) {
        c.advance(1);
        store.track('export.clicked');
      }
      expect(warn).toHaveBeenCalledTimes(1);
      d.resolveLoad();
      await loading;
      expect(store.getState().intents.upgrade?.contributions['limit.hit']).toBeUndefined();
      expect(store.getState().intents.upgrade?.contributions['export.clicked']).toBeDefined();
    });
  });

  it('without onError, a failed read warns once per phase in development; with onError nothing is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing: PersistAdapter = {
      load: () => {
        throw new Error('boom');
      },
      save: () => {},
    };
    const quiet = createIntentStore(config, { persist: throwing, now: () => T });
    await quiet.load();
    await quiet.load(); // the retry fails the same way: no second warning
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('the load failed');

    const handled = createIntentStore(config, {
      persist: throwing,
      now: () => T,
      onError: () => {},
    });
    await handled.load();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reveal checks and marks in one step, is false inside the cooldown, and fires again after it', () => {
    const c = clock();
    const store = createIntentStore(thin, { now: c.now });
    expect(store.reveal('tip')).toBe(false);
    store.track('s');
    expect(store.reveal('tip')).toBe(true);
    assertInvariants(store.getState());
    expect(store.getState().intents.tip?.revealCount).toBe(1);
    expect(store.reveal('tip')).toBe(false); // cooldown
    c.advance(DAY + MINUTE);
    expect(store.reveal('tip')).toBe(true);
    expect(store.getState().intents.tip?.revealCount).toBe(2);
    expect(store.reveal('tip', { threshold: 0.99 })).toBe(false);
  });

  it('observe, endEpisode and markRevealed accept timestamps of your own', () => {
    const store = createIntentStore(thin, { now: () => T });
    store.observe({ name: 's', at: T - MINUTE });
    store.markRevealed('tip', T - 30_000);
    expect(store.getState().intents.tip?.lastRevealedAt).toBe(T - 30_000);
    store.endEpisode(T);
    expect(store.getState().episode.startedAt).toBeNull();
    assertInvariants(store.getState());
  });

  it('exposes the validated config', () => {
    const store = createIntentStore(thin);
    expect(store.config).toStrictEqual(createState(thin).config);
  });
});
