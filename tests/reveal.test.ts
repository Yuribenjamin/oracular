import {
  createState,
  type EngineConfig,
  type EngineState,
  markRevealed,
  observe,
  predict,
  shouldReveal,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

/**
 * prior 0.3 with strength 2, so a few hits of `x` (+3) move p fast while evidence stays thin.
 * These tests pin the reveal gate on exact pseudo-counts (four `x` are α = 0.6 + 12), so repeats
 * add their full weight here; saturation has its own tests in observe.test.ts and evidence.test.ts.
 */
function thinConfig(overrides: Partial<EngineConfig['intents'][string]> = {}): EngineConfig {
  return {
    intents: {
      tip: {
        prior: 0.3,
        priorStrength: 2,
        halfLife: 7 * DAY,
        signals: { x: 3, y: -3 },
        outcome: 'tip.used',
        saturate: false,
        ...overrides,
      },
    },
  };
}

function hits(state: EngineState, n: number, at = T): EngineState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = observe(s, { name: 'x', at });
    assertInvariants(s);
  }
  return s;
}

describe('predict', () => {
  it('reports the prior for a fresh state', () => {
    const s = createState(upgradeConfig());
    const pred = predict(s, 'upgrade', T);
    expect(pred).toMatchObject({
      intent: 'upgrade',
      p: 0.05,
      evidence: 10,
      revealed: false,
      revealedAt: null,
    });
    const sd = Math.sqrt((0.5 * 9.5) / (10 * 10 * 11));
    expect(pred.sd).toBeCloseTo(sd, 12);
    expect(pred.lower).toBeCloseTo(Math.max(0, 0.05 - 1.28 * sd), 12);
    expect(pred.confidence).toBeCloseTo(1 - 2 * sd, 12);
  });

  it('does not change the stored state, even when it decays for the reading', () => {
    const s = hits(createState(thinConfig()), 2);
    const snapshot = structuredClone(s);
    predict(s, 'tip', T + 30 * DAY);
    expect(s).toStrictEqual(snapshot);
  });

  it('decays toward the prior over time through the public API', () => {
    const s = hits(createState(thinConfig()), 3);
    const prior = 0.3;
    let previousGap = Math.abs(predict(s, 'tip', T).p - prior);
    expect(previousGap).toBeGreaterThan(0.4);
    for (let k = 1; k <= 20; k++) {
      const pred = predict(s, 'tip', T + k * 7 * DAY);
      expect(Number.isFinite(pred.p) && Number.isFinite(pred.sd)).toBe(true);
      expect(pred.p).toBeGreaterThanOrEqual(0);
      expect(pred.p).toBeLessThanOrEqual(1);
      const gap = Math.abs(pred.p - prior);
      expect(gap).toBeLessThan(previousGap);
      previousGap = gap;
    }
    expect(previousGap).toBeLessThan(1e-3);
    expect(Math.abs(predict(s, 'tip', T + 140 * DAY).evidence - 2)).toBeLessThan(1e-3);
  });

  it('uses the z it is given for the lower bound', () => {
    const s = hits(createState(thinConfig()), 2);
    const loose = predict(s, 'tip', T, { z: 0 });
    const strict = predict(s, 'tip', T, { z: 3 });
    expect(loose.lower).toBeCloseTo(loose.p, 12);
    expect(strict.lower).toBeLessThan(loose.lower);
  });

  it('rejects unknown intents, bad times and bad options', () => {
    const s = createState(thinConfig());
    expect(() => predict(s, 'nope', T)).toThrow(RangeError);
    expect(() => predict(s, '', T)).toThrow(TypeError);
    expect(() => predict(s, 'tip', Number.NaN)).toThrow(TypeError);
    expect(() => predict(s, 'tip', T, { threshold: 2 })).toThrow(RangeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => predict(s, 'tip', T, { treshold: 0.5 } as any)).toThrow(TypeError);
  });
});

describe('shouldReveal', () => {
  it('is false below the threshold', () => {
    const s = createState(thinConfig());
    expect(predict(s, 'tip', T).p).toBeLessThan(0.5);
    expect(shouldReveal(s, 'tip', T)).toBe(false);
  });

  it('is false when p clears the threshold but the lower bound does not', () => {
    const s = hits(createState(thinConfig()), 1);
    const pred = predict(s, 'tip', T);
    expect(pred.p).toBeCloseTo(3.6 / 5, 12);
    expect(pred.lower).toBeLessThan(0.5);
    expect(shouldReveal(s, 'tip', T)).toBe(false);
  });

  it('fires once there is enough evidence', () => {
    const s = hits(createState(thinConfig()), 4);
    const pred = predict(s, 'tip', T);
    expect(pred.p).toBeCloseTo(12.6 / 14, 12);
    expect(pred.lower).toBeGreaterThanOrEqual(0.5);
    expect(shouldReveal(s, 'tip', T)).toBe(true);
  });

  it('honours per-call threshold and z overrides', () => {
    const s = hits(createState(thinConfig()), 4);
    expect(shouldReveal(s, 'tip', T)).toBe(true);
    expect(shouldReveal(s, 'tip', T, { threshold: 0.95 })).toBe(false);
    expect(shouldReveal(s, 'tip', T, { z: 10 })).toBe(false);
    expect(shouldReveal(s, 'tip', T, { threshold: 0.85, z: 0 })).toBe(true);
  });

  it('resolves options as call → intent → engine → default', () => {
    const s = hits(
      createState({ ...thinConfig({ reveal: { threshold: 0.8 } }), reveal: { threshold: 0.99 } }),
      4,
    );
    expect(shouldReveal(s, 'tip', T)).toBe(true); // intent's 0.8 beats the engine's 0.99
    expect(shouldReveal(s, 'tip', T, { threshold: 0.99 })).toBe(false);

    const engineOnly = hits(createState({ ...thinConfig(), reveal: { threshold: 0.99 } }), 4);
    expect(shouldReveal(engineOnly, 'tip', T)).toBe(false);
  });

  it('is false immediately after the outcome event, which resets the evidence', () => {
    let s = hits(createState(thinConfig()), 4);
    expect(shouldReveal(s, 'tip', T)).toBe(true);
    s = observe(s, { name: 'tip.used', at: T + MINUTE });
    assertInvariants(s);
    expect(shouldReveal(s, 'tip', T + MINUTE)).toBe(false);
    expect(predict(s, 'tip', T + MINUTE).p).toBeCloseTo(0.3, 12);
  });

  it('with resetOnOutcome: false the evidence survives the outcome, but the cooldown still applies', () => {
    let s = hits(createState(thinConfig({ resetOnOutcome: false, reveal: { cooldown: HOUR } })), 4);
    s = observe(s, { name: 'tip.used', at: T + MINUTE });
    assertInvariants(s);
    const pred = predict(s, 'tip', T + MINUTE);
    expect(pred.p).toBeGreaterThan(0.5);
    expect(pred.lower).toBeGreaterThan(0.5);
    expect(pred.suppressedUntil).toBe(T + MINUTE + HOUR);
    expect(shouldReveal(s, 'tip', T + MINUTE)).toBe(false);
    expect(shouldReveal(s, 'tip', T + MINUTE + HOUR)).toBe(true);
  });
});

describe('outcome cooldown', () => {
  it('records lastOutcomeAt on the intent', () => {
    let s = createState(thinConfig());
    expect(s.intents.tip!.lastOutcomeAt).toBeNull();
    s = observe(s, { name: 'tip.used', at: T });
    assertInvariants(s);
    expect(s.intents.tip!.lastOutcomeAt).toBe(T);
    s = observe(s, { name: 'tip.used', at: T + DAY });
    expect(s.intents.tip!.lastOutcomeAt).toBe(T + DAY);
  });

  it('keeps shouldReveal false after the outcome despite strong fresh evidence, until the cooldown ends', () => {
    let s = hits(createState(thinConfig({ halfLife: DAY })), 4);
    s = observe(s, { name: 'tip.used', at: T });
    s = hits(s, 6, T + 2 * MINUTE);

    const during = predict(s, 'tip', T + 2 * MINUTE);
    expect(during.p).toBeGreaterThan(0.5);
    expect(during.lower).toBeGreaterThan(0.5);
    expect(during.revealed).toBe(false);
    expect(during.suppressedUntil).toBe(T + DAY); // cooldown defaults to the one-day half-life
    expect(shouldReveal(s, 'tip', T + 2 * MINUTE)).toBe(false);
    expect(shouldReveal(s, 'tip', T + DAY - 1)).toBe(false);

    const after = predict(s, 'tip', T + DAY);
    expect(after.suppressedUntil).toBeNull();
    expect(after.lower).toBeGreaterThan(0.5);
    expect(shouldReveal(s, 'tip', T + DAY)).toBe(true);
  });

  it('suppressedUntil is the later of the reveal and outcome cooldowns', () => {
    const cfg = thinConfig({ reveal: { cooldown: HOUR } });
    let s = observe(createState(cfg), { name: 'tip.used', at: T });
    expect(predict(s, 'tip', T)).toMatchObject({ revealed: false, suppressedUntil: T + HOUR });

    s = markRevealed(s, 'tip', T + 10 * MINUTE);
    expect(predict(s, 'tip', T + 20 * MINUTE)).toMatchObject({
      revealed: true,
      revealedAt: T + 10 * MINUTE,
      suppressedUntil: T + 10 * MINUTE + HOUR,
    });
    // The outcome cooldown has ended, the reveal cooldown has not.
    expect(predict(s, 'tip', T + HOUR + MINUTE)).toMatchObject({
      revealed: true,
      suppressedUntil: T + 10 * MINUTE + HOUR,
    });
    expect(predict(s, 'tip', T + 10 * MINUTE + HOUR)).toMatchObject({
      revealed: false,
      suppressedUntil: null,
    });
  });

  it('a cooldown of 0 disables the outcome suppression too', () => {
    let s = hits(createState(thinConfig()), 4);
    s = observe(s, { name: 'tip.used', at: T });
    s = hits(s, 6, T);
    expect(shouldReveal(s, 'tip', T)).toBe(false);
    expect(shouldReveal(s, 'tip', T, { cooldown: 0 })).toBe(true);
    expect(predict(s, 'tip', T, { cooldown: 0 }).suppressedUntil).toBeNull();
  });
});

describe('markRevealed', () => {
  it('blocks a second reveal for the cooldown and shows in predict', () => {
    const cfg = thinConfig({ reveal: { cooldown: HOUR } });
    let s = hits(createState(cfg), 4);
    expect(shouldReveal(s, 'tip', T)).toBe(true);

    s = markRevealed(s, 'tip', T);
    assertInvariants(s);
    expect(s.intents.tip).toMatchObject({ lastRevealedAt: T, revealCount: 1 });
    expect(predict(s, 'tip', T)).toMatchObject({ revealed: true, revealedAt: T });
    expect(shouldReveal(s, 'tip', T)).toBe(false);
    expect(shouldReveal(s, 'tip', T + HOUR - 1)).toBe(false);
    expect(predict(s, 'tip', T + HOUR - 1).revealed).toBe(true);

    expect(predict(s, 'tip', T + HOUR).revealed).toBe(false);
    expect(shouldReveal(s, 'tip', T + HOUR)).toBe(true);

    s = markRevealed(s, 'tip', T + HOUR);
    assertInvariants(s);
    expect(s.intents.tip!.revealCount).toBe(2);
    expect(shouldReveal(s, 'tip', T + HOUR)).toBe(false);
  });

  it('defaults the cooldown to the intent half-life', () => {
    let s = hits(createState(thinConfig()), 6);
    s = markRevealed(s, 'tip', T);
    expect(predict(s, 'tip', T + 7 * DAY - 1).revealed).toBe(true);
    expect(predict(s, 'tip', T + 7 * DAY).revealed).toBe(false);
  });

  it('a cooldown of 0 disables the cooldown', () => {
    let s = hits(createState(thinConfig()), 4);
    s = markRevealed(s, 'tip', T);
    expect(shouldReveal(s, 'tip', T, { cooldown: 0 })).toBe(true);
    expect(predict(s, 'tip', T, { cooldown: 0 }).revealed).toBe(false);
  });

  it('leaves the evidence untouched', () => {
    const before = hits(createState(thinConfig()), 4);
    const after = markRevealed(before, 'tip', T);
    expect(after.intents.tip).toMatchObject({
      alpha: before.intents.tip!.alpha,
      beta: before.intents.tip!.beta,
      contributions: before.intents.tip!.contributions,
    });
    expect(before.intents.tip!.lastRevealedAt).toBeNull();
  });

  it('rejects unknown intents and bad times', () => {
    const s = createState(thinConfig());
    expect(() => markRevealed(s, 'nope', T)).toThrow(RangeError);
    expect(() => markRevealed(s, 'tip', Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});
