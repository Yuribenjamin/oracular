import fc from 'fast-check';
import {
  createState,
  type EngineConfig,
  evidenceToReveal,
  type IntentConfig,
  observe,
  predict,
  type RevealOptions,
  shouldReveal,
} from 'oracular';
import { presets } from 'oracular/presets';
import { describe, expect, it } from 'vitest';
import { betaQuantile, incompleteBeta, normalTail } from '../src/math';
import { assertInvariants, DAY, upgradeConfig } from './helpers';

fc.configureGlobal({ numRuns: 200, seed: Number(process.env.PROPERTY_SEED ?? 20261019) });

const T = 1_700_000_000_000;
/** The tail z = 1.28 names: a one-sided 90% bound. */
const Q10 = normalTail(1.28);

/** A state whose one intent sits at Beta(α, β) with no evidence yet: prior α/(α+β), strength α+β. */
function betaState(alpha: number, beta: number, intent?: RevealOptions, engine?: RevealOptions) {
  const x: IntentConfig = {
    prior: alpha / (alpha + beta),
    priorStrength: alpha + beta,
    halfLife: DAY,
    signals: { s: 1 },
  };
  if (intent !== undefined) x.reveal = intent;
  const config: EngineConfig = { intents: { x } };
  if (engine !== undefined) config.reveal = engine;
  return createState(config);
}

/** Signals of weight `w`, one per episode at full weight, until the gate opens. */
function signalsUntilReveal(intent: IntentConfig, w: number, opts: RevealOptions): number {
  let s = createState({ intents: { x: { ...intent, signals: { s: w }, saturate: false } } });
  for (let i = 1; i <= 2000; i++) {
    s = observe(s, { name: 's', at: T });
    assertInvariants(s);
    if (shouldReveal(s, 'x', T, opts)) return i;
  }
  return Number.POSITIVE_INFINITY;
}

// Beta(α, β) → p, the normal lower bound p − 1.28·sd, and the exact tenth percentile.
const TABLE: [number, number, number, number, number][] = [
  [1.5, 1.5, 0.5, 0.18, 0.156],
  [4, 3, 0.571, 0.347, 0.333],
  [6, 4, 0.6, 0.411, 0.401],
  [12, 8, 0.6, 0.463, 0.459],
  [30, 20, 0.6, 0.512, 0.511],
];

describe('the exact lower bound', () => {
  it('matches the Beta quantile table at z 1.28, through the math and through predict', () => {
    for (const [a, b, p, normal, exact] of TABLE) {
      expect(Math.abs(betaQuantile(Q10, a, b) - exact), `Beta(${a}, ${b})`).toBeLessThan(1e-3);
      const s = betaState(a, b);
      expect(Math.abs(predict(s, 'x', T).p - p)).toBeLessThan(1e-3);
      expect(Math.abs(predict(s, 'x', T).lower - normal)).toBeLessThan(1e-3);
      expect(Math.abs(predict(s, 'x', T, { bound: 'exact' }).lower - exact)).toBeLessThan(1e-3);
    }
    // The willBuy preset's prior: vanishingly small, never zero.
    expect(betaQuantile(Q10, 0.192, 3.808)).toBeLessThan(1e-3);
    expect(betaQuantile(Q10, 0.192, 3.808)).toBeGreaterThan(0);
    expect(Math.abs(betaQuantile(Q10, 50, 50) - 0.4361)).toBeLessThan(1e-3);
  });

  it('incompleteBeta: 0 at 0, 1 at 1, the identity for Beta(1, 1), and symmetric', () => {
    for (const [a, b] of [
      [1, 1],
      [0.5, 2],
      [3, 7],
      [20, 0.3],
    ]) {
      expect(incompleteBeta(0, a!, b!)).toBe(0);
      expect(incompleteBeta(1, a!, b!)).toBe(1);
      for (const x of [0.1, 0.5, 0.9]) {
        expect(incompleteBeta(x, a!, b!) + incompleteBeta(1 - x, b!, a!)).toBeCloseTo(1, 10);
      }
    }
    for (const x of [0.1, 0.25, 0.5, 0.9]) expect(incompleteBeta(x, 1, 1)).toBeCloseTo(x, 11);
  });

  it('normalTail is Φ(−z) at the levels the docs quote', () => {
    expect(normalTail(0)).toBeCloseTo(0.5, 6);
    expect(normalTail(1.28)).toBeCloseTo(0.10027, 4);
    expect(normalTail(1.64)).toBeCloseTo(0.0505, 4);
    expect(normalTail(2.33)).toBeCloseTo(0.0099, 4);
    expect(normalTail(10)).toBeGreaterThan(0);
    expect(normalTail(10)).toBeLessThan(1e-20);
  });

  it('moves nothing unless set, and resolves call → intent → engine → default', () => {
    const normal = predict(betaState(1.5, 1.5), 'x', T).lower;
    expect(normal).toBeCloseTo(0.18, 12);
    const exact = betaQuantile(Q10, 1.5, 1.5);
    expect(predict(betaState(1.5, 1.5, { bound: 'normal' }), 'x', T).lower).toBe(normal);
    expect(predict(betaState(1.5, 1.5, undefined, { bound: 'exact' }), 'x', T).lower).toBe(exact);
    const intentWins = betaState(1.5, 1.5, { bound: 'normal' }, { bound: 'exact' });
    expect(predict(intentWins, 'x', T).lower).toBe(normal);
    expect(predict(intentWins, 'x', T, { bound: 'exact' }).lower).toBe(exact);
    expect(shouldReveal(intentWins, 'x', T, { threshold: 0.17 })).toBe(true);
    expect(shouldReveal(intentWins, 'x', T, { threshold: 0.17, bound: 'exact' })).toBe(false);
  });

  it('rejects anything but "normal" or "exact", naming the path', () => {
    const bad = { bound: 'wilson' } as unknown as RevealOptions;
    expect(() => predict(betaState(2, 2), 'x', T, bad)).toThrow(
      'oracular: options.bound must be "normal" or "exact"',
    );
    expect(() => createState({ ...upgradeConfig(), reveal: bad })).toThrow(
      'oracular: config.reveal.bound must be "normal" or "exact"',
    );
  });

  it('evidenceToReveal follows the option: the exact gate asks for more, and agrees with brute force', () => {
    const upgrade = upgradeConfig().intents.upgrade!;
    expect(evidenceToReveal(upgrade, { bound: 'exact' })).toBeGreaterThan(
      evidenceToReveal(upgrade),
    );
    for (const prior of [0.05, 0.3])
      for (const priorStrength of [2, 10, 50])
        for (const [threshold, z] of [
          [0.3, 1.28],
          [0.5, 0],
          [0.5, 1.28],
          [0.7, 1.64],
        ] as const)
          for (const w of [1, 3]) {
            const intent: IntentConfig = { prior, priorStrength, halfLife: DAY, signals: { s: w } };
            const opts: RevealOptions = { threshold, z, bound: 'exact' };
            const needed = evidenceToReveal(intent, opts);
            const label = `prior ${prior} strength ${priorStrength} θ ${threshold} z ${z} w ${w}`;
            expect(Math.ceil(needed / w - 1e-9), label).toBe(signalsUntilReveal(intent, w, opts));
          }
  });

  it('stays finite at the extremes: z 10, the median at z 0, the willBuy prior, a prior near 1', () => {
    const s = betaState(4, 3);
    const far = predict(s, 'x', T, { z: 10, bound: 'exact' }).lower;
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(1e-3);
    // z = 0 is the median, which for a left-skewed Beta sits above the mean.
    const median = predict(s, 'x', T, { z: 0, bound: 'exact' }).lower;
    expect(median).toBeGreaterThan(predict(s, 'x', T).p);
    expect(incompleteBeta(median, 4, 3)).toBeCloseTo(0.5, 6);
    // Beta(0.192, 3.808) is the willBuy preset before any evidence.
    const will = createState({ intents: { buy: presets.willBuy } });
    const lower = predict(will, 'buy', T, { bound: 'exact' }).lower;
    expect(lower).toBeGreaterThan(0);
    expect(lower).toBeLessThan(1e-4);
    const needed = evidenceToReveal(presets.willBuy, { bound: 'exact' });
    expect(Number.isFinite(needed)).toBe(true);
    expect(needed).toBeGreaterThan(evidenceToReveal(presets.willBuy));
    // Beta(10, 0.01): the exact tenth percentile sits above the mean, so lower > p is possible.
    const skewed = predict(betaState(10, 0.01), 'x', T, { bound: 'exact' });
    expect(skewed.lower).toBeGreaterThan(skewed.p);
  });

  const shape = fc.oneof(
    fc.constantFrom(0.01, 0.05, 0.192, 0.5, 1),
    fc.integer({ min: 4, max: 800 }).map((n) => n / 4),
  );
  const wellConditioned = fc.integer({ min: 4, max: 800 }).map((n) => n / 4);
  const level = fc.oneof(
    fc.constantFrom(1e-6, 1e-12, 7.6e-24, 0.5),
    fc.integer({ min: 1, max: 5000 }).map((n) => n / 10_000),
  );

  it('round trip: I(Q(q)) = q to 1e-6 for α, β ≥ 1', () => {
    fc.assert(
      fc.property(wellConditioned, wellConditioned, level, (a, b, q) => {
        expect(Math.abs(incompleteBeta(betaQuantile(q, a, b), a, b) - q)).toBeLessThanOrEqual(1e-6);
      }),
    );
  });

  it('full range α, β ∈ [0.01, 200]: finite, strictly inside (0, 1), monotone in q and in α', () => {
    fc.assert(
      fc.property(shape, shape, level, level, shape, (a, b, q1, q2, a2) => {
        const x = betaQuantile(q1, a, b);
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(1);
        const [lo, hi] = q1 <= q2 ? [q1, q2] : [q2, q1];
        expect(betaQuantile(lo, a, b)).toBeLessThanOrEqual(betaQuantile(hi, a, b) + 1e-9);
        const [small, large] = a <= a2 ? [a, a2] : [a2, a];
        expect(betaQuantile(q1, small, b)).toBeLessThanOrEqual(betaQuantile(q1, large, b) + 1e-9);
      }),
    );
  });
});
