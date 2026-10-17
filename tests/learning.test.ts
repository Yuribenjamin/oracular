import { createState, type EngineConfig, type EngineState, endEpisode, observe } from 'oracular';
import { describe, expect, it } from 'vitest';
import { resolveLearning } from '../src/config';
import { signalWeights } from '../src/learning';
import { decayFactor } from '../src/math';
import { assertInvariants, DAY, MINUTE } from './helpers';

const T = 1_700_000_000_000;

function buyConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    intents: {
      buy: {
        prior: 0.1,
        priorStrength: 10,
        halfLife: DAY,
        signals: { A: 1, B: 1, C: 1, N: -2 },
        outcome: 'buy.done',
      },
    },
    ...overrides,
  };
}

function weights(state: EngineState, signal: string) {
  return signalWeights(
    state.intents.buy!,
    state.config.intents.buy!,
    resolveLearning(state.config),
    signal,
  );
}

/**
 * One session: some activity, the given signals, then either the outcome or nothing, and the
 * session ends a minute later. An outcome resolves the intent but does not end the episode, so
 * the app (here: the test) still ends it.
 */
function episode(state: EngineState, at: number, signals: string[], outcome: boolean): EngineState {
  let s = observe(state, { name: 'app.opened', at });
  for (const name of signals) {
    s = observe(s, { name, at });
    assertInvariants(s);
  }
  if (outcome) s = observe(s, { name: 'buy.done', at: at + MINUTE });
  s = endEpisode(s, at + MINUTE);
  assertInvariants(s);
  return s;
}

/** 10 episodes where A precedes the outcome, interleaved with 10 where B is seen and nothing follows. */
function twentyEpisodes(state: EngineState): EngineState {
  let s = state;
  for (let i = 0; i < 10; i++) {
    s = episode(s, T + 2 * i * DAY, ['A'], true);
    s = episode(s, T + (2 * i + 1) * DAY, ['B'], false);
  }
  return s;
}

describe('learning', () => {
  it('after 20 episodes, A (always followed by the outcome) is above its initial weight and B (never) below', () => {
    const s = twentyEpisodes(createState(buyConfig()));
    const a = weights(s, 'A');
    const b = weights(s, 'B');

    expect(a).toMatchObject({ initial: 1, hits: 10, misses: 0 });
    expect(b).toMatchObject({ initial: 1, hits: 0, misses: 10 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 10, misses: 10 });
    expect(a.effective).toBeGreaterThan(a.initial);
    expect(b.effective).toBeLessThan(b.initial);

    // Pin the formula: q_A = 11/12, q_B = 1/12, base rate 11/22, gain 2, priorEpisodes 10.
    const base = 11 / 22;
    const learnedA = 2 * ((11 / 12 - base) / (1 - base));
    const learnedB = 2 * ((1 / 12 - base) / base);
    expect(a.learned).toBeCloseTo(learnedA, 12);
    expect(b.learned).toBeCloseTo(learnedB, 12);
    expect(a.effective).toBeCloseTo((10 * 1 + 10 * learnedA) / 20, 12);
    expect(b.effective).toBeCloseTo((10 * 1 + 10 * learnedB) / 20, 12);
    expect(b.effective).toBeLessThan(0);
  });

  it('a signal with no completed episodes keeps exactly its initial weight and has learned nothing', () => {
    const s = twentyEpisodes(createState(buyConfig()));
    expect(weights(s, 'C')).toStrictEqual({
      initial: 1,
      learned: 0,
      effective: 1,
      hits: 0,
      misses: 0,
    });

    // Even when the base rate is far from 50%.
    let skewed = createState(buyConfig());
    for (let i = 0; i < 9; i++) skewed = episode(skewed, T + i * DAY, ['A'], true);
    expect(weights(skewed, 'C')).toStrictEqual({
      initial: 1,
      learned: 0,
      effective: 1,
      hits: 0,
      misses: 0,
    });
  });

  it('is centered on the base rate: a signal present in every episode of a 90% intent learns nothing', () => {
    let s = createState(buyConfig());
    for (let i = 0; i < 20; i++) s = episode(s, T + i * DAY, ['C'], i % 10 !== 9);
    const c = weights(s, 'C');
    expect(c).toMatchObject({ hits: 18, misses: 2 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 18, misses: 2 });
    expect(Math.abs(c.learned)).toBeLessThan(1e-12);
    // No lift means the history says "no evidence", so the blend pulls the weight toward 0, never up.
    expect(c.effective).toBeCloseTo(1 / 3, 12);
  });

  it('a signal followed by the outcome only half the time still learns positive when the base rate is low', () => {
    let s = createState(buyConfig());
    let at = T;
    for (let i = 0; i < 10; i++) {
      at += DAY;
      s = episode(s, at, ['C'], i % 2 === 0);
    }
    for (let i = 0; i < 30; i++) {
      at += DAY;
      s = episode(s, at, [], false);
    }
    const c = weights(s, 'C');
    expect(c).toMatchObject({ hits: 5, misses: 5 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 5, misses: 35 });
    expect(c.learned).toBeGreaterThan(0);
  });

  it('priorEpisodes sets how many episodes it takes for history to outweigh the developer', () => {
    const effectiveA = (priorEpisodes: number) =>
      weights(twentyEpisodes(createState(buyConfig({ learning: { priorEpisodes } }))), 'A')
        .effective;
    const fast = effectiveA(2);
    const normal = effectiveA(10);
    const slow = effectiveA(50);
    expect(fast).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(1);
  });

  it('gain caps the learned weight at gain × |initial| and a perfect predictor approaches it', () => {
    let s = createState(buyConfig({ learning: { gain: 1.5 } }));
    for (let i = 0; i < 200; i++)
      s = episode(s, T + i * DAY, i % 2 === 0 ? ['A'] : ['B'], i % 2 === 0);
    const a = weights(s, 'A');
    expect(a.learned).toBeLessThanOrEqual(1.5);
    expect(a.learned).toBeGreaterThan(1.45);
    expect(a.effective).toBeGreaterThan(1.4);
  });

  it('a negative initial weight can learn its way positive', () => {
    let s = createState(buyConfig());
    for (let i = 0; i < 10; i++) {
      s = episode(s, T + 2 * i * DAY, ['N'], true);
      s = episode(s, T + (2 * i + 1) * DAY, [], false);
    }
    const n = weights(s, 'N');
    expect(n.initial).toBe(-2);
    expect(n.learned).toBeGreaterThan(0);
    expect(n.effective).toBeGreaterThan(n.initial);
    expect(n.effective).toBeGreaterThan(0);
  });

  it('applies the effective weight, not the initial one, on the next occurrence', () => {
    const s = twentyEpisodes(createState(buyConfig()));
    const at = T + 30 * DAY;
    const d = decayFactor(at - s.intents.buy!.updatedAt!, DAY);

    const a = weights(s, 'A');
    const nextA = observe(s, { name: 'A', at });
    assertInvariants(nextA);
    expect(nextA.intents.buy!.contributions.A).toStrictEqual({ alpha: a.effective, beta: 0 });

    // B still carries a decayed contribution from the last B episode; the new (negative) weight lands in beta.
    const b = weights(s, 'B');
    const leftover = s.intents.buy!.contributions.B!;
    const nextB = observe(s, { name: 'B', at });
    assertInvariants(nextB);
    expect(nextB.intents.buy!.contributions.B!.alpha).toBeCloseTo(leftover.alpha * d, 12);
    expect(nextB.intents.buy!.contributions.B!.beta).toBeCloseTo(
      leftover.beta * d - b.effective,
      12,
    );
  });

  it('forgets with learning.halfLife, and never without it', () => {
    const run = (config: EngineConfig) => {
      let s = createState(config);
      for (let i = 0; i < 10; i++) s = episode(s, T, ['A'], true);
      s = observe(s, { name: 'A', at: T + MINUTE + 7 * DAY });
      assertInvariants(s);
      return s.intents.buy!;
    };
    const forgetful = run(buyConfig({ learning: { halfLife: 7 * DAY } }));
    expect(forgetful.learned.A).toStrictEqual({ hits: 5, misses: 0 });
    expect(forgetful.episodes).toStrictEqual({ hits: 5, misses: 0 });

    const steady = run(buyConfig());
    expect(steady.learned.A).toStrictEqual({ hits: 10, misses: 0 });
    expect(steady.episodes).toStrictEqual({ hits: 10, misses: 0 });
  });

  it('an idle gap longer than episodeTimeout records misses like an explicit end', () => {
    let s = createState(buyConfig({ episodeTimeout: 30 * MINUTE }));
    s = observe(s, { name: 'B', at: T });
    s = observe(s, { name: 'A', at: T + DAY });
    assertInvariants(s);
    expect(s.intents.buy!.learned.B).toStrictEqual({ hits: 0, misses: 1 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 0, misses: 1 });
  });
});
