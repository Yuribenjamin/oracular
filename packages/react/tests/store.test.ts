import { createState, observe, STATE_VERSION, serialize } from 'oracular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInvariants, DAY, MINUTE, upgradeConfig } from '../../../tests/helpers';
import { createIntentStore, type PersistAdapter } from '../src';

const T = 1_700_000_000_000;

/** A synchronous adapter that records every write. */
function fakeAdapter(initial: string | null = null) {
  const writes: string[] = [];
  let stored = initial;
  const adapter: PersistAdapter = {
    load: () => stored,
    save: (json) => {
      stored = json;
      writes.push(json);
    },
  };
  return { adapter, writes };
}

function clock(start = T) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** One signal of weight 5 on a weak prior opens the gate at once; the cooldown is the day-long half-life. */
const thin = {
  intents: {
    tip: { prior: 0.5, priorStrength: 2, halfLife: DAY, signals: { s: 5 }, saturate: false },
  },
};

describe('createIntentStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
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
    const store = createIntentStore(upgradeConfig(), { now: () => T });
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
    const store = createIntentStore(upgradeConfig(), {
      persist: adapter,
      now: c.now,
      saveDelay: 250,
    });
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

  it('writes at once when an episode closes, explicitly or by timeout', async () => {
    const { adapter, writes } = fakeAdapter();
    const c = clock();
    const store = createIntentStore(upgradeConfig({ episodeTimeout: 30 * MINUTE }), {
      persist: adapter,
      now: c.now,
    });
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
    const config = upgradeConfig();
    const saved = serialize(observe(createState(config), { name: 'pricing.viewed', at: T - DAY }));
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
    const config = upgradeConfig();
    const saved = serialize(observe(createState(config), { name: 'pricing.viewed', at: T - DAY }));
    const { adapter, writes } = fakeAdapter(saved);
    const store = createIntentStore(config, { persist: adapter, now: () => T });
    await store.load();
    expect(serialize(store.getState())).toBe(saved);
    await vi.advanceTimersByTimeAsync(1000);
    await store.flush();
    expect(writes).toHaveLength(0);
  });

  it('loads once; a second load is a no-op', async () => {
    const { adapter } = fakeAdapter(serialize(createState(upgradeConfig())));
    let loads = 0;
    const counting: PersistAdapter = {
      load: () => {
        loads++;
        return adapter.load();
      },
      save: adapter.save,
    };
    const store = createIntentStore(upgradeConfig(), { persist: counting, now: () => T });
    await store.load();
    await store.load();
    expect(loads).toBe(1);
  });

  it('keeps a fresh state when the load throws or holds garbage, and reports it; a failing save is reported too', async () => {
    const config = upgradeConfig();
    const phases: string[] = [];
    const onError = (_error: unknown, phase: string) => {
      phases.push(phase);
    };
    const throwing = createIntentStore(config, {
      persist: {
        load: () => {
          throw new Error('boom');
        },
        save: () => {},
      },
      onError,
      now: () => T,
    });
    await throwing.load();
    expect(throwing.getState()).toStrictEqual(createState(config));

    const garbage = createIntentStore(config, {
      persist: { load: () => '{"version":', save: () => {} },
      onError,
      now: () => T,
    });
    await garbage.load();
    expect(garbage.getState()).toStrictEqual(createState(config));

    const failing = createIntentStore(config, {
      persist: {
        load: () => null,
        save: () => {
          throw new Error('quota');
        },
      },
      onError,
      now: () => T,
    });
    failing.track('pricing.viewed');
    await failing.flush();
    expect(phases).toStrictEqual(['load', 'load', 'save']);
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
