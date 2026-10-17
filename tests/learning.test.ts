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

    // Pin the formula. A: seen in 10 episodes, all with the outcome → qWith = 11/12; the other
    // 10 episodes had no outcome → qWithout = 1/12. B is the mirror image. gain 2, priorEpisodes 10.
    const qWithA = 11 / 12;
    const qWithoutA = 1 / 12;
    const learnedA = 2 * ((qWithA - qWithoutA) / (1 - qWithoutA));
    const qWithB = 1 / 12;
    const qWithoutB = 11 / 12;
    const learnedB = 2 * ((qWithB - qWithoutB) / qWithoutB);
    expect(a.learned).toBeCloseTo(learnedA, 12);
    expect(b.learned).toBeCloseTo(learnedB, 12);
    // nEff = (10 × 10) / (10 + 10) = 5 for both.
    expect(a.effective).toBeCloseTo((10 * 1 + 5 * learnedA) / 15, 12);
    expect(b.effective).toBeCloseTo((10 * 1 + 5 * learnedB) / 15, 12);
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

  it('a signal that has never been absent keeps its initial weight: learning needs contrast', () => {
    // C is in every one of 20 episodes, 18 of which end with the outcome. There is no session
    // without C to compare against, so there is no counterfactual and nothing to learn from.
    let s = createState(buyConfig());
    for (let i = 0; i < 20; i++) s = episode(s, T + i * DAY, ['C'], i % 10 !== 9);
    const c = weights(s, 'C');
    expect(c).toMatchObject({ hits: 18, misses: 2 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 18, misses: 2 });
    expect(Math.abs(c.effective - c.initial)).toBeLessThanOrEqual(1e-9);
  });

  it('after a single confirmed episode the seen signal keeps exactly its initial weight', () => {
    // One episode with A and the outcome: A has been present once and absent never, so nEff = 0.
    const s = episode(createState(buyConfig()), T, ['A'], true);
    const a = weights(s, 'A');
    expect(a).toMatchObject({ initial: 1, hits: 1, misses: 0 });
    expect(Math.abs(a.effective - a.initial)).toBeLessThanOrEqual(1e-9);
  });

  it('trial scenario: one confirmed episode with A, then five episodes with neither A nor the outcome', () => {
    let s = episode(createState(buyConfig()), T, ['A'], true);
    for (let i = 1; i <= 5; i++) s = episode(s, T + i * DAY, [], false);
    const a = weights(s, 'A');
    expect(a).toMatchObject({ initial: 1, hits: 1, misses: 0 });
    expect(s.intents.buy!.episodes).toStrictEqual({ hits: 1, misses: 5 });
    // qWith = 2/3, qWithout = 1/7, lift = (2/3 − 1/7) / (1 − 1/7), learned = 2 × lift,
    // nEff = (1 × 5) / (1 + 5), effective = (10 + nEff × learned) / (10 + nEff) ≈ 1.017.
    const lift = (2 / 3 - 1 / 7) / (1 - 1 / 7);
    const nEff = (1 * 5) / 6;
    const expected = (10 * 1 + nEff * 2 * lift) / (10 + nEff);
    expect(a.effective).toBeCloseTo(expected, 12);
    expect(a.effective).toBeGreaterThan(a.initial);
    expect(a.effective).toBeLessThan(1.05);
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
    // 20 confirmed episodes with N and 20 without it: nEff = 10, enough to outweigh priorEpisodes.
    let s = createState(buyConfig());
    for (let i = 0; i < 20; i++) {
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

    // B still carries a decayed contribution from the last B episode. Its effective weight after
    // 20 episodes is small; whichever sign it has, that is the side the new occurrence lands on.
    const b = weights(s, 'B');
    const leftover = s.intents.buy!.contributions.B!;
    const nextB = observe(s, { name: 'B', at });
    assertInvariants(nextB);
    const c = nextB.intents.buy!.contributions.B!;
    if (b.effective >= 0) {
      expect(c.alpha).toBeCloseTo(leftover.alpha * d + b.effective, 12);
      expect(c.beta).toBeCloseTo(leftover.beta * d, 12);
    } else {
      expect(c.alpha).toBeCloseTo(leftover.alpha * d, 12);
      expect(c.beta).toBeCloseTo(leftover.beta * d - b.effective, 12);
    }
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
