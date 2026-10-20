import {
  createState,
  type EngineState,
  endEpisode,
  type IntentState,
  observe,
  predict,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { decayIntent } from '../src/intent';
import { decayFactor } from '../src/math';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const config = upgradeConfig();
const intent = config.intents.upgrade!;
const prior = intent.prior;
const T = 1_700_000_000_000;

function pOf(is: IntentState): number {
  return is.alpha / (is.alpha + is.beta);
}

/** Deterministic PRNG (mulberry32) so the randomized test is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('decay', () => {
  function withEvidence(): EngineState {
    let state = createState(config);
    state = observe(state, { name: 'pricing.viewed', at: T });
    state = observe(state, { name: 'limit.hit', at: T });
    assertInvariants(state);
    return state;
  }

  it('with no events, p drifts back toward the prior and never leaves [0, 1]', () => {
    const start = withEvidence().intents.upgrade!;
    expect(pOf(start)).toBeGreaterThan(prior);
    let previousGap = Math.abs(pOf(start) - prior);
    for (let k = 1; k <= 20; k++) {
      const p = pOf(decayIntent(start, intent, T + k * intent.halfLife));
      expect(Number.isNaN(p)).toBe(false);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      const gap = Math.abs(p - prior);
      expect(gap).toBeLessThan(previousGap);
      previousGap = gap;
    }
    expect(previousGap).toBeLessThan(1e-3);
  });

  it('evidence (α + β) returns to the prior strength', () => {
    const start = withEvidence().intents.upgrade!;
    expect(start.alpha + start.beta).toBeCloseTo(15, 12);
    const later = decayIntent(start, intent, T + 20 * intent.halfLife);
    expect(Math.abs(later.alpha + later.beta - intent.priorStrength)).toBeLessThan(1e-3);
  });

  it('one half-life halves every contribution', () => {
    const start = withEvidence().intents.upgrade!;
    const later = decayIntent(start, intent, T + intent.halfLife);
    expect(later.contributions['pricing.viewed']).toStrictEqual({ alpha: 1.5, beta: 0 });
    expect(later.contributions['limit.hit']).toStrictEqual({ alpha: 1, beta: 0 });
    expect(later.alpha).toBeCloseTo(0.5 + 1.5 + 1, 12);
    expect(later.beta).toBeCloseTo(9.5, 12);
    expect(later.updatedAt).toBe(T + intent.halfLife);
  });

  it('negative evidence decays back up toward the prior', () => {
    const state = observe(createState(config), { name: 'plan.downgraded', at: T });
    assertInvariants(state);
    const start = state.intents.upgrade!;
    expect(pOf(start)).toBeLessThan(prior);
    const later = decayIntent(start, intent, T + 3 * intent.halfLife);
    expect(pOf(later)).toBeGreaterThan(pOf(start));
    expect(pOf(later)).toBeLessThan(prior);
  });

  it('a clock that runs backwards neither throws nor decays: the evidence is held and the anchor moves to the new time', () => {
    let state = withEvidence();
    state = observe(state, { name: 'export.clicked', at: T - HOUR });
    assertInvariants(state);
    const is = state.intents.upgrade!;
    expect(is.updatedAt).toBe(T - HOUR);
    expect(is.contributions['pricing.viewed']).toStrictEqual({ alpha: 3, beta: 0 });
    expect(is.contributions['export.clicked']).toStrictEqual({ alpha: 1, beta: 0 });
    // Decay resumes from the new anchor: an hour on, the evidence has decayed by one hour.
    const later = decayIntent(is, intent, T);
    expect(later.contributions['pricing.viewed']!.alpha).toBeCloseTo(
      3 * 2 ** (-HOUR / intent.halfLife),
      12,
    );
    // A read before the anchor shows the held evidence, undecayed.
    expect(predict(state, 'upgrade', T - 2 * HOUR).p).toBe(predict(state, 'upgrade', T - HOUR).p);
  });

  it('one event stamped in the future cannot hold the intent: the next event re-anchors it and decay resumes', () => {
    let s = withEvidence();
    s = observe(s, { name: 'export.clicked', at: T + 4 * 365 * DAY }); // a clock years ahead
    // Held until the next write: a read at the right time sees what the anchor sees, undecayed.
    expect(predict(s, 'upgrade', T + MINUTE).p).toBe(predict(s, 'upgrade', T + 4 * 365 * DAY).p);
    s = observe(s, { name: 'export.clicked', at: T + MINUTE }); // the clock corrected
    assertInvariants(s);
    expect(s.intents.upgrade!.updatedAt).toBe(T + MINUTE);
    const soon = predict(s, 'upgrade', T + MINUTE).p;
    const later = predict(s, 'upgrade', T + MINUTE + 60 * DAY).p;
    expect(later).toBeLessThan(soon);
    expect(Math.abs(later - prior)).toBeLessThan(0.01); // eight half-lives on: back at the prior
  });

  it('an infinite gap decays everything away, and a gap that is not a number decays nothing', () => {
    expect(decayFactor(Number.POSITIVE_INFINITY, DAY)).toBe(0);
    expect(decayFactor(Number.NaN, DAY)).toBe(1);
    expect(decayFactor(-HOUR, DAY)).toBe(1);
    expect(decayFactor(0, DAY)).toBe(1);
    let s = createState(config);
    s = observe(s, { name: 'pricing.viewed', at: -Number.MAX_VALUE });
    expect(predict(s, 'upgrade', Number.MAX_VALUE).p).toBe(prior);
  });

  it('is lazy: an event for one intent leaves the others untouched', () => {
    const two = upgradeConfig({
      intents: {
        ...config.intents,
        churn: { prior: 0.1, priorStrength: 5, halfLife: DAY, signals: { 'session.short': 1 } },
      },
    });
    const before = createState(two);
    const after = observe(before, { name: 'pricing.viewed', at: T });
    assertInvariants(after);
    expect(after.intents.churn).toBe(before.intents.churn);
    expect(after.intents.upgrade).not.toBe(before.intents.upgrade);
  });

  it('survives 2000 random events, gaps and episode ends without NaN or leaving [0, 1]', () => {
    const random = rng(42);
    const names = [
      ...Object.keys(intent.signals),
      intent.outcome!,
      'noise.a',
      'noise.b',
      'constructor',
    ];
    const gaps = [0, 0, 1, MINUTE, HOUR, 3 * DAY, 60 * DAY, -MINUTE, -2 * DAY];
    let state = createState(upgradeConfig({ episodeTimeout: 45 * MINUTE }));
    let at = T;
    for (let i = 0; i < 2000; i++) {
      at += gaps[Math.floor(random() * gaps.length)]!;
      if (random() < 0.05) {
        state = endEpisode(state, at);
      } else {
        state = observe(state, { name: names[Math.floor(random() * names.length)]!, at });
      }
      assertInvariants(state);
      const p = pOf(state.intents.upgrade!);
      expect(Number.isNaN(p)).toBe(false);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
