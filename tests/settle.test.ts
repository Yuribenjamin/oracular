import {
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode,
  observe,
  predict,
  serialize,
  settleState,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, deepFreeze, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;
const config = upgradeConfig({ episodeTimeout: 30 * MINUTE });

function activeState(currentConfig: EngineConfig = config): EngineState {
  const initial = createState(currentConfig);
  assertInvariants(initial);
  const active = observe(initial, { name: 'pricing.viewed', at: T });
  assertInvariants(active);
  return active;
}

function settle(state: EngineState, at: number): EngineState {
  const settled = settleState(state, at);
  assertInvariants(settled);
  return settled;
}

describe('settleState', () => {
  it('settles a restored expired session before any new event, without mutating the input', () => {
    const saved = serialize(activeState());
    const restored = deepFreeze(deserialize(saved));
    assertInvariants(restored);
    const settled = settle(restored, T + HOUR);
    expect(settled.episode).toStrictEqual({ startedAt: null, lastEventAt: null, intents: {} });
    expect(settled.intents.upgrade!.learned['pricing.viewed']).toStrictEqual({
      hits: 0,
      misses: 1,
    });
    expect(settled.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 1 });
    expect(serialize(restored)).toBe(saved);
    expect(settle(settled, T + HOUR)).toBe(settled);
    expect(settle(settled, T + 2 * HOUR).intents.upgrade!.episodes.misses).toBe(1);
  });

  it('preserves recent sessions and the existing strict timeout boundary without extending them', () => {
    const active = activeState();
    for (const elapsed of [10 * MINUTE, 30 * MINUTE]) {
      const settled = settle(active, T + elapsed);
      expect(settled.episode).toBe(active.episode);
      expect(settled.episode.lastEventAt).toBe(T);
      expect(settled.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 0 });
    }
    expect(settle(active, T + 30 * MINUTE + 1).episode.startedAt).toBeNull();
  });

  it('keeps sessions open without an idle timeout, while still decaying their evidence', () => {
    const active = activeState(upgradeConfig());
    const at = T + 7 * 24 * HOUR;
    const settled = settle(active, at);
    expect(settled.episode).toBe(active.episode);
    expect(settled.intents.upgrade!.learned).toStrictEqual({});
    expect(settled.intents.upgrade!.contributions['pricing.viewed']!.alpha).toBe(1.5);
    expect(predict(settled, 'upgrade', at)).toStrictEqual(predict(active, 'upgrade', at));
  });

  it('records a timeout miss at the timeout and then decays it to startup time', () => {
    const active = activeState({ ...config, learning: { halfLife: HOUR } });
    const settled = settle(active, T + 90 * MINUTE);
    expect(settled.intents.upgrade!.learned['pricing.viewed']!.misses).toBeCloseTo(0.5, 12);
    expect(settled.intents.upgrade!.episodes.misses).toBeCloseTo(0.5, 12);
    expect(settled.intents.upgrade!.learnedAt).toBe(T + 90 * MINUTE);
  });

  it('keeps valid attribution windows open and credits a subsequent outcome', () => {
    const attributed: EngineConfig = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, attribution: 2 * HOUR } },
    };
    const settled = settle(activeState(attributed), T + HOUR);
    expect(settled.episode.startedAt).toBeNull();
    expect(settled.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 0 });
    expect(settled.intents.upgrade!.pending).toStrictEqual([
      { endedAt: T + 30 * MINUTE, seen: ['pricing.viewed'] },
    ]);
    const completed = observe(settled, { name: 'upgrade.completed', at: T + HOUR });
    assertInvariants(completed);
    expect(completed.intents.upgrade!.pending).toStrictEqual([]);
    expect(completed.intents.upgrade!.learned['pricing.viewed']!.hits).toBeCloseTo(
      2 ** (-(30 * MINUTE) / (7 * 24 * HOUR)),
      12,
    );
  });

  it('settles an attribution window that expired while the app was shut down', () => {
    const attributed: EngineConfig = {
      ...config,
      learning: { halfLife: HOUR },
      intents: { upgrade: { ...config.intents.upgrade!, attribution: HOUR } },
    };
    // The session expired at +30m, attribution expired at +90m, and startup is at +150m.
    const settled = settle(activeState(attributed), T + 150 * MINUTE);
    expect(settled.intents.upgrade!.pending).toStrictEqual([]);
    expect(settled.intents.upgrade!.learned['pricing.viewed']!.misses).toBeCloseTo(0.5, 12);
    expect(settled.intents.upgrade!.episodes.misses).toBeCloseTo(0.5, 12);
  });

  it('settles already-pending attribution even when there is no open session', () => {
    const attributed: EngineConfig = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, attribution: HOUR } },
    };
    const closed = endEpisode(activeState(attributed), T + MINUTE);
    assertInvariants(closed);
    const settled = settle(closed, T + 2 * HOUR);
    expect(settled.intents.upgrade!.pending).toStrictEqual([]);
    expect(settled.intents.upgrade!.episodes.misses).toBe(1);
  });

  it('settles every intent, including those not touched by the last event', () => {
    const multiple: EngineConfig = {
      ...config,
      intents: {
        ...config.intents,
        help: { prior: 0.1, priorStrength: 5, halfLife: HOUR, signals: { error: 2 } },
      },
    };
    const settled = settle(activeState(multiple), T + HOUR);
    for (const intent of Object.values(settled.intents)) {
      expect(intent.episodes.misses).toBe(1);
      expect(intent.updatedAt).toBe(T + HOUR);
      expect(intent.learnedAt).toBe(T + HOUR);
    }
    expect(settled.intents.help!.learned).toStrictEqual({});
  });

  it('does not count a completed outcome again at startup', () => {
    const completed = observe(activeState(), { name: 'upgrade.completed', at: T + MINUTE });
    assertInvariants(completed);
    const settled = settle(completed, T + HOUR);
    expect(settled.intents.upgrade!.episodes).toStrictEqual({ hits: 1, misses: 0 });
  });

  it('advances a fresh clock without opening an episode and remains idempotent', () => {
    const settled = settle(createState(config), T);
    expect(settled.clock).toStrictEqual({ at: T, behindAt: null });
    expect(settled.episode.startedAt).toBeNull();
    expect(settle(settled, T)).toBe(settled);
    expect(settle(settled, T - HOUR)).toBe(settled);
  });

  it('preserves a held backwards event until another event confirms the correction', () => {
    const held = observe(activeState(), { name: 'pricing.viewed', at: T - MINUTE });
    const settled = settle(held, T + MINUTE);
    expect(settled.clock).toStrictEqual({ at: T + MINUTE, behindAt: T - MINUTE });
    const corrected = observe(settled, { name: 'pricing.viewed', at: T - MINUTE });
    assertInvariants(corrected);
    expect(corrected.clock).toStrictEqual({ at: T - MINUTE, behindAt: null });
  });

  it('counts a post-outcome attempt as a miss when episodePerOutcome is enabled', () => {
    const attempts = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, episodePerOutcome: true } },
    };
    let state = observe(activeState(attempts), { name: 'upgrade.completed', at: T + MINUTE });
    state = observe(state, { name: 'pricing.viewed', at: T + 2 * MINUTE });
    const settled = settle(state, T + HOUR);
    expect(settled.intents.upgrade!.episodes).toStrictEqual({ hits: 1, misses: 1 });
    expect(settled.intents.upgrade!.learned['pricing.viewed']).toStrictEqual({
      hits: 1,
      misses: 1,
    });
  });

  it('tolerates backwards clocks and rejects invalid inputs', () => {
    const active = activeState();
    const settled = settle(active, T - HOUR);
    expect(settled.episode).toBe(active.episode);
    expect(settled.intents.upgrade!.updatedAt).toBe(T);
    expect(settled.intents.upgrade!.learnedAt).toBe(T);
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => settleState(active, at)).toThrow(TypeError);
    }
    expect(() => settleState(null as unknown as EngineState, T)).toThrow(TypeError);
  });
});
