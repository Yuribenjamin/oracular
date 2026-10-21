// @vitest-environment node
import { createState, endEpisode, observe, serialize } from 'oracular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOUR, MINUTE, upgradeConfig } from '../../../tests/helpers';
import { createIntentStore } from '../src';
import { deferredAdapter, fakeAdapter, T } from './adapters';

const DAY = 24 * HOUR;
const config = upgradeConfig({ episodeTimeout: 30 * MINUTE });
const saved = serialize(observe(createState(config), { name: 'pricing.viewed', at: T }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(wall: number, options: { settleOnLoad?: boolean; maxResumeGap?: number } = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(wall);
  let elapsed = 0;
  const io = fakeAdapter(saved);
  const store = createIntentStore(config, {
    persist: io.adapter,
    monotonicNow: () => elapsed,
    ...options,
  });
  return {
    store,
    io,
    advance: (ms: number) => {
      elapsed += ms;
    },
  };
}

describe('the store clock anchored to saved history', () => {
  it('keeps history unchanged by default even after a plausible absence', async () => {
    const { store, io } = setup(T + HOUR);
    await store.load();
    await store.flush();
    expect(serialize(store.getState())).toBe(saved);
    expect(store.getClockStatus()).toBe('steady');
    expect(store.now()).toBe(T + HOUR);
    expect(io.writes).toHaveLength(0);
    await store.dispose();
  });

  it.each([T - DAY, 0, T + 31 * DAY, Number.NaN, Number.POSITIVE_INFINITY])(
    'holds at history for suspicious device time %s',
    async (wall) => {
      const { store, io, advance } = setup(wall, { settleOnLoad: true });
      await store.load();
      expect(store.getClockStatus()).toBe('held');
      expect(store.now()).toBe(T);
      expect(serialize(store.getState())).toBe(saved);
      advance(MINUTE);
      expect(store.now()).toBe(T + MINUTE);
      store.track('limit.hit');
      expect(store.getState().episode.startedAt).toBe(T);
      expect(store.getState().episode.lastEventAt).toBe(T + MINUTE);
      expect(store.getState().intents.upgrade!.episodes.misses).toBe(0);
      await store.flush();
      expect(io.writes).toHaveLength(1);
      await store.dispose();
    },
  );

  it('ignores device-clock changes in either direction while running', async () => {
    const { store, advance } = setup(T + MINUTE);
    await store.load();
    vi.mocked(Date.now).mockReturnValue(T + 1000 * DAY);
    advance(100);
    expect(store.now()).toBe(T + MINUTE + 100);
    vi.mocked(Date.now).mockReturnValue(0);
    advance(100);
    expect(store.now()).toBe(T + MINUTE + 200);
    expect(store.getClockStatus()).toBe('steady');
    await store.dispose();
  });

  it('settles an accepted gap only when enabled and saves after the debounce', async () => {
    vi.useFakeTimers();
    const { store, io } = setup(T + HOUR, { settleOnLoad: true });
    await store.load();
    expect(store.getState().episode.startedAt).toBeNull();
    expect(store.getState().intents.upgrade!.episodes.misses).toBe(1);
    expect(io.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(io.writes).toHaveLength(1);
    await store.dispose();
  });

  it('uses a configurable bound and accepts its exact boundary', async () => {
    const { store } = setup(T + 40 * DAY, { maxResumeGap: 40 * DAY });
    await store.load();
    expect(store.getClockStatus()).toBe('steady');
    expect(store.now()).toBe(T + 40 * DAY);
    await store.dispose();
  });

  it('reanchors queued store events and closes while retaining their elapsed spacing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T + 1000 * DAY);
    let elapsed = 0;
    const io = deferredAdapter(saved);
    const store = createIntentStore(config, {
      persist: io.adapter,
      monotonicNow: () => elapsed,
      settleOnLoad: true,
    });
    const loading = store.load();
    elapsed = MINUTE;
    store.track('limit.hit');
    elapsed = 2 * MINUTE;
    store.markRevealed('upgrade');
    elapsed = 3 * MINUTE;
    store.endEpisode();
    elapsed = 4 * MINUTE;
    store.track('export.clicked');
    elapsed = 5 * MINUTE;
    io.resolveLoad();
    await loading;
    const state = store.getState();
    expect(store.now()).toBe(T + 5 * MINUTE);
    expect(state.intents.upgrade!.lastRevealedAt).toBe(T + 2 * MINUTE);
    expect(state.episode.startedAt).toBe(T + 4 * MINUTE);
    expect(state.intents.upgrade!.episodes.misses).toBe(1);
    expect(state.intents.upgrade!.learned['limit.hit']!.misses).toBe(1);
    expect(state.intents.upgrade!.updatedAt).toBe(T + 4 * MINUTE);
    await store.dispose();
  });

  it('keeps caller-stamped events and explicit clock overrides unchanged', async () => {
    const io = deferredAdapter(saved);
    let at = T + HOUR;
    const store = createIntentStore(config, { persist: io.adapter, now: () => at });
    const loading = store.load();
    store.track('limit.hit');
    at += HOUR;
    io.resolveLoad();
    await loading;
    expect(store.getClockStatus()).toBe('custom');
    expect(store.getState().episode.lastEventAt).toBe(T + HOUR);
    expect(store.now()).toBe(T + 2 * HOUR);
    await store.dispose();
  });

  it('includes pending episode closes when finding the latest history time', async () => {
    const attributed = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, attribution: HOUR } },
    };
    const active = observe(createState(attributed), { name: 'pricing.viewed', at: T });
    const ended = endEpisode(active, T + MINUTE);
    vi.spyOn(Date, 'now').mockReturnValue(T - DAY);
    const io = fakeAdapter(serialize(ended));
    const store = createIntentStore(attributed, { persist: io.adapter, monotonicNow: () => 0 });
    await store.load();
    expect(store.now()).toBe(T + MINUTE);
    await store.dispose();
  });

  it('holds safely if the monotonic source fails or moves backwards', async () => {
    const { store, advance } = setup(T - DAY, { settleOnLoad: true });
    await store.load();
    advance(100);
    expect(store.now()).toBe(T + 100);
    advance(-200);
    expect(store.now()).toBe(T + 100);
    expect(store.getClockStatus()).toBe('held');
    await store.dispose();
  });
});

it('holds if the runtime has no monotonic clock instead of using a jumping device clock', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(T + HOUR);
  const performance = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
  try {
    const io = fakeAdapter(saved);
    const store = createIntentStore(config, { persist: io.adapter, settleOnLoad: true });
    await store.load();
    expect(store.getClockStatus()).toBe('held');
    expect(store.now()).toBe(T);
    vi.mocked(Date.now).mockReturnValue(T + 100 * DAY);
    expect(store.now()).toBe(T);
    expect(serialize(store.getState())).toBe(saved);
    await store.flush();
    expect(io.writes).toHaveLength(0);
    await store.dispose();
  } finally {
    Object.defineProperty(globalThis, 'performance', { value: performance, configurable: true });
  }
});

it.each(['AsyncStorage', 'MMKV'])(
  'anchors %s history without a browser clock or network',
  async (kind) => {
    const { asyncStorageAdapter, mmkvAdapter } = await import('../src');
    vi.spyOn(Date, 'now').mockReturnValue(0);
    let value = saved;
    let elapsed = 0;
    const persist =
      kind === 'AsyncStorage'
        ? asyncStorageAdapter('history', {
            getItem: async () => value,
            setItem: async (_key, json) => {
              value = json;
            },
          })
        : mmkvAdapter('history', {
            getString: () => value,
            set: (_key, json) => {
              value = json;
            },
          });
    const store = createIntentStore(config, {
      persist,
      monotonicNow: () => elapsed,
      settleOnLoad: true,
    });
    await store.load();
    expect(value).toBe(saved);
    elapsed = 100;
    store.track('limit.hit');
    expect(store.getState().episode.lastEventAt).toBe(T + 100);
    await store.flush();
    expect(value).toBe(serialize(store.getState()));
    await store.dispose();
  },
);
