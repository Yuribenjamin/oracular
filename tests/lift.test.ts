import fc from 'fast-check';
import {
  createState,
  deserialize,
  type EngineState,
  endEpisode,
  explain,
  type LiftType,
  observe,
  predict,
  serialize,
  shouldReveal,
  validateConfig,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { LIFT_TYPES } from '../src/config';
import { learningScore, lift } from '../src/math';
import { assertInvariants, DAY, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

// q = 0.75, b = 0.25. Association-rule uses the overall rate 0.5 instead.
const examples: [LiftType, number][] = [
  ['absolute-difference', 0.5],
  ['relative-lift', 2],
  ['risk-ratio', 3],
  ['log-lift', Math.log(3)],
  ['odds-ratio', 9],
  ['normalized-difference', 2 / 3],
  ['association-rule', 1.5],
];

// Expected evidence scores for the same rates, independently calculated from the documented transforms.
const scores: Record<LiftType, number> = {
  'absolute-difference': 0.5,
  'relative-lift': 2 / 3,
  'risk-ratio': 0.5,
  'log-lift': Math.log(3) / (1 + Math.log(3)),
  'odds-ratio': 0.8,
  'normalized-difference': 2 / 3,
  'association-rule': 0.2,
};

describe('lift formulas', () => {
  for (const [type, expected] of examples) {
    it(type, () => {
      expect(lift(0.75, type === 'association-rule' ? 0.5 : 0.25, type)).toBeCloseTo(expected, 12);
    });
  }

  it('preserves the original default arithmetic on both sides and at endpoints', () => {
    for (const [q, b] of [
      [0.75, 0.25],
      [0.25, 0.75],
      [0.5, 0.5],
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]) {
      const expected =
        q! >= b! ? (b! >= 1 ? 0 : (q! - b!) / (1 - b!)) : b! <= 0 ? 0 : (q! - b!) / b!;
      expect(lift(q!, b!)).toBe(expected);
      expect(lift(q!, b!, 'normalized-difference')).toBe(expected);
    }
  });

  it('uses zero for neutral differences and one for neutral ratios', () => {
    for (const type of LIFT_TYPES) {
      const ratio = ['risk-ratio', 'odds-ratio', 'association-rule'].includes(type);
      expect(lift(0.4, 0.4, type)).toBe(ratio ? 1 : 0);
      const negative = lift(0.25, 0.75, type);
      expect(negative).toBeLessThan(ratio ? 1 : 0);
      if (ratio) expect(negative).toBeGreaterThan(0);
    }
  });

  it('keeps every formula finite when probabilities reach floating-point endpoints', () => {
    for (const type of LIFT_TYPES) {
      for (const [q, b] of [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [1e-150, 1 - Number.EPSILON],
      ]) {
        expect(Number.isFinite(lift(q!, b!, type))).toBe(true);
      }
    }
  });
});

/** Two successful signal episodes and two unsuccessful episodes without it. */
function train(type?: LiftType): EngineState {
  const config = upgradeConfig(type === undefined ? {} : { learning: { lift: type } });
  let state = createState(config);
  assertInvariants(state);
  for (let i = 0; i < 4; i++) {
    state = observe(state, { name: i < 2 ? 'pricing.viewed' : 'app.opened', at: T + i * DAY });
    assertInvariants(state);
    if (i < 2) {
      state = observe(state, { name: 'upgrade.completed', at: T + i * DAY });
      assertInvariants(state);
    }
    state = endEpisode(state, T + i * DAY);
    assertInvariants(state);
  }
  return state;
}

describe('constructor lift selection', () => {
  for (const type of LIFT_TYPES) {
    const expected = scores[type];
    it(`learns, applies and persists ${type}`, () => {
      const state = train(type);
      const at = T + 4 * DAY;
      const signal = explain(state, 'upgrade', at).find((s) => s.signal === 'pricing.viewed')!;
      // gain 2, initial weight 3, nEff = 1, priorEpisodes = 10.
      expect(signal.learnedWeight).toBeCloseTo(6 * expected, 12);
      expect(signal.effectiveWeight).toBeCloseTo((30 + 6 * expected) / 11, 12);
      const restored = deserialize(serialize(state));
      assertInvariants(restored);
      expect(restored).toStrictEqual(state);
      expect(explain(restored, 'upgrade', at)).toStrictEqual(explain(state, 'upgrade', at));
      const next = observe(restored, { name: 'pricing.viewed', at });
      assertInvariants(next);
      expect(next.intents.upgrade!.contributions['pricing.viewed']!.alpha).toBeCloseTo(
        signal.effectiveWeight,
        12,
      );
    });

    it(`keeps ${type} at the prior when there is no contrast`, () => {
      let state = createState(upgradeConfig({ learning: { lift: type } }));
      assertInvariants(state);
      state = observe(state, { name: 'pricing.viewed', at: T });
      assertInvariants(state);
      state = observe(state, { name: 'upgrade.completed', at: T });
      assertInvariants(state);
      const signal = explain(state, 'upgrade', T).find((s) => s.signal === 'pricing.viewed')!;
      expect(signal.effectiveWeight).toBe(3);
      const unseen = explain(state, 'upgrade', T).find((s) => s.signal === 'limit.hit')!;
      expect(unseen.learnedWeight).toBe(0);
      expect(unseen.effectiveWeight).toBe(2);
    });
  }

  it('keeps unspecified lift identical to explicitly selecting the current formula', () => {
    expect(explain(train(), 'upgrade', T + 4 * DAY)).toStrictEqual(
      explain(train('normalized-difference'), 'upgrade', T + 4 * DAY),
    );
    expect(train().config.learning).toBeUndefined();
  });

  it('can change lift when loading a saved state without losing its history', () => {
    const previous = train();
    const config = upgradeConfig({ learning: { lift: 'risk-ratio' } });
    const restored = deserialize(serialize(previous), { config });
    assertInvariants(restored);
    expect(restored.intents.upgrade!.learned).toStrictEqual(previous.intents.upgrade!.learned);
    expect(
      explain(restored, 'upgrade', T + 4 * DAY).find((s) => s.signal === 'pricing.viewed')!
        .learnedWeight,
    ).toBe(3);
  });

  it('uses the marginal outcome rate for association-rule lift on unequal group sizes', () => {
    let state = train('association-rule');
    state = observe(state, { name: 'app.opened', at: T + 4 * DAY });
    assertInvariants(state);
    state = endEpisode(state, T + 4 * DAY);
    assertInvariants(state);
    const signal = explain(state, 'upgrade', T + 4 * DAY).find(
      (s) => s.signal === 'pricing.viewed',
    )!;
    // Shrunk toward the base rate 2/5: q = (2 + 0.8) / 4 = 0.7, P(B) = (2 + 0.8) / 7 = 0.4,
    // lift 1.75, score (1.75 − 1) / (1.75 + 1) = 3/11.
    expect(signal.learnedWeight).toBeCloseTo(6 * (3 / 11), 12);
  });

  it('rejects invalid selectors with the config path', () => {
    for (const value of ['unknown', '', null, 7, {}, () => 0, '__proto__']) {
      const config = { ...upgradeConfig(), learning: { lift: value } };
      expect(() => validateConfig(config)).toThrow(TypeError);
      expect(() => validateConfig(config)).toThrow('oracular: config.learning.lift');
      expect(() => createState(config as Parameters<typeof createState>[0])).toThrow(TypeError);
    }
  });
});

describe('learning score contract', () => {
  const score = (q: number, b: number, type: LiftType) => learningScore(lift(q, b, type), type);

  it.each(LIFT_TYPES)('%s is neutral at zero, signed, bounded and monotone', (type) => {
    const rates = [0, Number.EPSILON, 0.001, 0.1, 0.5, 0.9, 0.999, 1 - Number.EPSILON, 1];
    for (const baseline of rates) {
      expect(score(baseline, baseline, type)).toBe(0);
      let previous = -1;
      for (const rate of rates) {
        const value = score(rate, baseline, type);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 1, max: 999 }), (q, b) => {
        expect(Math.sign(score(q / 1000, b / 1000, type))).toBe(Math.sign(q - b));
      }),
      { seed: 20261020, numRuns: 100 },
    );
  });

  it.each(['risk-ratio', 'odds-ratio', 'association-rule'] as const)(
    '%s gives reciprocal ratios equal and opposite evidence',
    (type) => {
      for (const ratio of [0.01, 0.5, 1, 2, 100]) {
        expect(learningScore(ratio, type)).toBeCloseTo(-learningScore(1 / ratio, type), 14);
      }
    },
  );
});

/** Balanced groups with a neutral, predictive or anti-predictive pricing signal. */
function trainAssociation(
  type: LiftType,
  association: 'neutral' | 'positive' | 'negative',
  count = 20,
  initial = 3,
  gain = 2,
): EngineState {
  const base = upgradeConfig({ learning: { lift: type, gain } });
  let state = createState({
    ...base,
    intents: { upgrade: { ...base.intents.upgrade!, signals: { 'pricing.viewed': initial } } },
  });
  assertInvariants(state);
  for (let i = 0; i < count; i++) {
    const withSignal = i < count / 2;
    const outcome =
      association === 'neutral' ? i % 2 === 0 : withSignal === (association === 'positive');
    const at = T + i * DAY;
    state = observe(state, { name: withSignal ? 'pricing.viewed' : 'app.opened', at });
    assertInvariants(state);
    if (outcome) {
      state = observe(state, { name: 'upgrade.completed', at });
      assertInvariants(state);
    }
    state = endEpisode(state, at);
    assertInvariants(state);
  }
  return state;
}

describe.each(LIFT_TYPES)('%s learning behavior', (type) => {
  it('shrinks a neutral signal toward zero for either initial sign', () => {
    for (const initial of [3, -3]) {
      const state = trainAssociation(type, 'neutral', 20, initial);
      const signal = explain(state, 'upgrade', T + 20 * DAY)[0]!;
      expect([signal.hits, signal.misses]).toStrictEqual([5, 5]);
      expect(signal.learnedWeight).toBe(0);
      // Ten sessions on each side: nEff = 5. The prior keeps 10 / (10 + 5) of its weight.
      expect(signal.effectiveWeight).toBe(initial * (2 / 3));
    }
  });

  it('bounds learned magnitude by gain for either initial sign, including gain below one', () => {
    for (const gain of [0.25, 2, 10]) {
      for (const initial of [3, -3]) {
        const state = trainAssociation(type, 'positive', 20, initial, gain);
        const signal = explain(state, 'upgrade', T + 20 * DAY)[0]!;
        expect(signal.learnedWeight).toBeGreaterThan(0);
        expect(Math.abs(signal.learnedWeight)).toBeLessThanOrEqual(gain * Math.abs(initial));
        expect(signal.effectiveWeight).toBeGreaterThanOrEqual(
          Math.min(initial, signal.learnedWeight),
        );
        expect(signal.effectiveWeight).toBeLessThanOrEqual(Math.max(initial, signal.learnedWeight));
      }
    }
  });

  it('turns an anti-predictive signal into evidence against the intent with enough history', () => {
    const count = 200;
    const state = trainAssociation(type, 'negative', count);
    const at = T + count * DAY;
    const signal = explain(state, 'upgrade', at)[0]!;
    expect(signal.learnedWeight).toBeLessThan(0);
    expect(signal.learnedWeight).toBeGreaterThanOrEqual(-6);
    expect(signal.effectiveWeight).toBeLessThan(0);
    const next = observe(state, { name: 'pricing.viewed', at });
    assertInvariants(next);
    expect(next.intents.upgrade!.alpha).toBe(state.intents.upgrade!.alpha);
    expect(next.intents.upgrade!.beta).toBeGreaterThan(state.intents.upgrade!.beta);
    expect(predict(next, 'upgrade', at).p).toBeLessThan(predict(state, 'upgrade', at).p);
  });

  it('cannot turn one occurrence into hundreds of evidence units and open the default gate', () => {
    const state = trainAssociation(type, 'positive');
    const at = T + 20 * DAY;
    const next = observe(state, { name: 'pricing.viewed', at });
    assertInvariants(next);
    expect(predict(next, 'upgrade', at).evidence).toBeLessThanOrEqual(10 + 6);
    expect(shouldReveal(next, 'upgrade', at)).toBe(false);
  });
});
