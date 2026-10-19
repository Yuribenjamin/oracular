import {
  createState,
  deserialize,
  type EngineState,
  endEpisode,
  explain,
  type LiftType,
  observe,
  serialize,
  validateConfig,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { LIFT_TYPES } from '../src/config';
import { lift } from '../src/math';
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
  for (const [type, expected] of examples) {
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
    ).toBe(18);
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
    // +1 per cell: P(A,B)=3/9, P(A)=4/9, P(B)=4/9; lift = 27/16.
    expect(signal.learnedWeight).toBeCloseTo(6 * (27 / 16), 12);
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
