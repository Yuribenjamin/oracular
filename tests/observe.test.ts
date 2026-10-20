import { createState, type EngineConfig, endEpisode, observe } from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const config = upgradeConfig();
/** The same intent with sessions that end after 30 idle minutes, which switches saturation on. */
const sessions = upgradeConfig({ episodeTimeout: 30 * MINUTE });
const T = 1_700_000_000_000;

describe('observe', () => {
  it('unknown events open and extend the episode without touching intents', () => {
    const s0 = createState(config);
    const s1 = observe(s0, { name: 'app.opened', at: T });
    assertInvariants(s1);
    expect(s1.episode).toStrictEqual({ startedAt: T, lastEventAt: T, intents: {} });
    expect(s1.intents).toStrictEqual(s0.intents);

    const s2 = observe(s1, { name: 'app.focused', at: T + MINUTE });
    assertInvariants(s2);
    expect(s2.episode).toStrictEqual({ startedAt: T, lastEventAt: T + MINUTE, intents: {} });
  });

  it('adds a positive weight to α and a negative weight to β', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      alpha: 3.5,
      beta: 9.5,
      updatedAt: T,
      contributions: { 'pricing.viewed': { alpha: 3, beta: 0 } },
    });
    expect(s.episode.intents.upgrade).toStrictEqual({
      seen: ['pricing.viewed'],
      counts: { 'pricing.viewed': 1 },
      resolved: false,
    });

    s = observe(s, { name: 'plan.downgraded', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      alpha: 3.5,
      beta: 13.5,
      contributions: {
        'pricing.viewed': { alpha: 3, beta: 0 },
        'plan.downgraded': { alpha: 0, beta: 4 },
      },
    });
    expect(s.episode.intents.upgrade!.seen).toStrictEqual(['pricing.viewed', 'plan.downgraded']);
  });

  it('saturates a repeated signal: the n-th occurrence in an episode adds w × log2(1 + 1/n)', () => {
    let s = observe(createState(sessions), { name: 'limit.hit', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade!.contributions['limit.hit']).toStrictEqual({ alpha: 2, beta: 0 });
    s = observe(s, { name: 'limit.hit', at: T });
    assertInvariants(s);
    // 2 + 2 × log2(3/2) = 2 × log2(3) = 3.1699…
    expect(s.intents.upgrade!.contributions['limit.hit']!.alpha).toBeCloseTo(2 * Math.log2(3), 12);
    expect(s.intents.upgrade!.alpha).toBeCloseTo(0.5 + 2 * Math.log2(3), 12);
    for (let n = 3; n <= 10; n++) {
      s = observe(s, { name: 'limit.hit', at: T });
      assertInvariants(s);
    }
    // Ten occurrences add 2 × log2(11) = 6.92, not 20.
    expect(s.intents.upgrade!.contributions['limit.hit']!.alpha).toBeCloseTo(2 * Math.log2(11), 12);
    expect(s.episode.intents.upgrade).toStrictEqual({
      seen: ['limit.hit'],
      counts: { 'limit.hit': 10 },
      resolved: false,
    });
  });

  it('saturates negative signals the same way, in β', () => {
    let s = createState(sessions);
    for (let n = 1; n <= 3; n++) {
      s = observe(s, { name: 'plan.downgraded', at: T });
      assertInvariants(s);
    }
    // −4 three times: 4 × log2(4) = 8 in β.
    expect(s.intents.upgrade!.contributions['plan.downgraded']!.beta).toBeCloseTo(8, 12);
  });

  it('with saturate: false every occurrence adds its full weight', () => {
    const linear: EngineConfig = {
      ...sessions,
      intents: { upgrade: { ...sessions.intents.upgrade!, saturate: false } },
    };
    let s = observe(createState(linear), { name: 'limit.hit', at: T });
    s = observe(s, { name: 'limit.hit', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade!.contributions['limit.hit']).toStrictEqual({ alpha: 4, beta: 0 });
    expect(s.episode.intents.upgrade!.counts).toStrictEqual({ 'limit.hit': 2 });
  });

  it('without episodeTimeout, repeats add their full weight unless saturate: true', () => {
    // Without an idle timeout, episodes end only through endEpisode. An app that never calls it
    // would discount a signal forever, so saturation is off by default there.
    let s = observe(createState(config), { name: 'limit.hit', at: T });
    s = observe(s, { name: 'limit.hit', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade!.contributions['limit.hit']).toStrictEqual({ alpha: 4, beta: 0 });
    expect(s.episode.intents.upgrade!.counts).toStrictEqual({ 'limit.hit': 2 });

    const optIn: EngineConfig = {
      intents: { upgrade: { ...config.intents.upgrade!, saturate: true } },
    };
    let o = observe(createState(optIn), { name: 'limit.hit', at: T });
    o = observe(o, { name: 'limit.hit', at: T });
    assertInvariants(o);
    expect(o.intents.upgrade!.contributions['limit.hit']!.alpha).toBeCloseTo(2 * Math.log2(3), 12);
  });

  it('restarts the count when the episode ends and when the outcome arrives', () => {
    const repeat = (state: ReturnType<typeof createState>, at: number) => {
      const next = observe(state, { name: 'limit.hit', at });
      assertInvariants(next);
      return next;
    };
    const kept: EngineConfig = {
      ...sessions,
      intents: { upgrade: { ...sessions.intents.upgrade!, resetOnOutcome: false } },
    };
    let s = repeat(repeat(createState(kept), T), T);
    const two = s.intents.upgrade!.contributions['limit.hit']!.alpha;
    expect(two).toBeCloseTo(2 * Math.log2(3), 12);
    // The outcome resets this intent's count (and only the count: resetOnOutcome is off).
    s = observe(s, { name: 'upgrade.completed', at: T });
    assertInvariants(s);
    s = repeat(s, T);
    expect(s.intents.upgrade!.contributions['limit.hit']!.alpha).toBeCloseTo(two + 2, 12);
    // A new episode starts the count again too.
    s = endEpisode(s, T);
    assertInvariants(s);
    s = repeat(s, T);
    expect(s.intents.upgrade!.contributions['limit.hit']!.alpha).toBeCloseTo(two + 4, 12);
    expect(s.episode.intents.upgrade!.counts).toStrictEqual({ 'limit.hit': 1 });
  });

  it('on the outcome: seen signals get a hit, the episode counts, evidence resets to the prior', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'limit.hit', at: T + MINUTE });
    s = observe(s, { name: 'upgrade.completed', at: T + 2 * MINUTE });
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      alpha: 0.5,
      beta: 9.5,
      contributions: {},
      learned: { 'pricing.viewed': { hits: 1, misses: 0 }, 'limit.hit': { hits: 1, misses: 0 } },
      episodes: { hits: 1, misses: 0 },
      learnedAt: T + 2 * MINUTE,
    });
    expect(s.episode.intents.upgrade).toStrictEqual({ seen: [], counts: {}, resolved: true });
    expect(s.episode.startedAt).toBe(T);
  });

  it('resetOnOutcome: false keeps the evidence', () => {
    const keep = patchIntent(config, { resetOnOutcome: false });
    let s = observe(createState(keep), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'upgrade.completed', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      alpha: 3.5,
      contributions: { 'pricing.viewed': { alpha: 3, beta: 0 } },
      learned: { 'pricing.viewed': { hits: 1, misses: 0 } },
      episodes: { hits: 1, misses: 0 },
    });
  });

  it('an outcome with nothing seen still counts toward the base rate', () => {
    const s = observe(createState(config), { name: 'upgrade.completed', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade!.learned).toStrictEqual({});
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 1, misses: 0 });
  });

  it('an event stamped before the last one moves the episode clock back, and the idle gap is measured from there', () => {
    let s = observe(createState(sessions), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'limit.hit', at: T + 20 * MINUTE }); // a clock that was ahead
    s = observe(s, { name: 'export.clicked', at: T + MINUTE }); // corrected: no gap to time out
    expect(s.episode).toMatchObject({ startedAt: T, lastEventAt: T + MINUTE });
    s = observe(s, { name: 'pricing.viewed', at: T + 32 * MINUTE }); // 31 idle minutes: a new episode
    assertInvariants(s);
    expect(s.episode.startedAt).toBe(T + 32 * MINUTE);
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 1 });
  });

  it('a repeated outcome with no signal seen since the last one is not another episode', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'upgrade.completed', at: T + 1 });
    s = observe(s, { name: 'upgrade.completed', at: T + 2 }); // a duplicate event
    assertInvariants(s);
    expect(s.intents.upgrade!.learned).toStrictEqual({ 'pricing.viewed': { hits: 1, misses: 0 } });
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 1, misses: 0 });
    expect(s.intents.upgrade!.lastOutcomeAt).toBe(T + 2);
  });

  it('a second outcome in the same episode rewards the signals seen since the first', () => {
    const keep = patchIntent(config, { resetOnOutcome: false });
    let s = observe(createState(keep), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'upgrade.completed', at: T + 1 });
    s = observe(s, { name: 'limit.hit', at: T + 2 });
    s = observe(s, { name: 'upgrade.completed', at: T + 3 });
    assertInvariants(s);
    expect(s.intents.upgrade!.learned).toStrictEqual({
      'pricing.viewed': { hits: 1, misses: 0 },
      'limit.hit': { hits: 1, misses: 0 },
    });
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 2, misses: 0 });
  });

  it('an event that is both a signal and the outcome is applied but never remembered', () => {
    const cfg: EngineConfig = {
      intents: {
        buy: {
          prior: 0.1,
          priorStrength: 10,
          halfLife: DAY,
          signals: { 'cart.viewed': 2, 'checkout.completed': 5 },
          outcome: 'checkout.completed',
          resetOnOutcome: false,
        },
      },
    };
    let s = observe(createState(cfg), { name: 'cart.viewed', at: T });
    s = observe(s, { name: 'checkout.completed', at: T + 1 });
    assertInvariants(s);
    expect(s.intents.buy!.contributions['checkout.completed']).toStrictEqual({ alpha: 5, beta: 0 });
    expect(s.intents.buy!.learned).toStrictEqual({ 'cart.viewed': { hits: 1, misses: 0 } });
  });

  it('accepts and ignores event props', () => {
    const plain = observe(createState(config), { name: 'pricing.viewed', at: T });
    const withProps = observe(createState(config), {
      name: 'pricing.viewed',
      at: T,
      props: { plan: 'pro', nested: { deep: [1, 2, 3] } },
    });
    assertInvariants(withProps);
    expect(withProps).toStrictEqual(plain);
  });

  it('treats inherited property names as ordinary event names', () => {
    const s0 = createState(config);
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const s1 = observe(s0, { name, at: T });
      assertInvariants(s1);
      expect(s1.intents).toStrictEqual(s0.intents);
    }
    const weird = createState({
      intents: {
        x: {
          prior: 0.2,
          priorStrength: 4,
          halfLife: DAY,
          signals: { toString: 1, constructor: -1 },
        },
      },
    });
    const s2 = observe(observe(weird, { name: 'toString', at: T }), { name: 'constructor', at: T });
    assertInvariants(s2);
    // toEqual, not toStrictEqual: an own key named "constructor" shadows vitest's type check.
    expect(s2.intents.x!.contributions).toEqual({
      toString: { alpha: 1, beta: 0 },
      constructor: { alpha: 0, beta: 1 },
    });
  });

  it('rejects malformed events', () => {
    const s = createState(config);
    const bad: unknown[] = [
      null,
      {},
      { name: '', at: T },
      { name: 'x' },
      { name: 'x', at: Number.NaN },
      { name: 'x', at: '1' },
      { name: 'x', at: T, props: 'nope' },
    ];
    for (const event of bad) {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      expect(() => observe(s, event as any)).toThrow(TypeError);
    }
  });

  it('rejects things that are not engine state', () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => observe({} as any, { name: 'x', at: T })).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => endEpisode(null as any, T)).toThrow(TypeError);
  });
});

describe('endEpisode', () => {
  it('gives seen signals a miss, counts the episode, and closes it', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    s = endEpisode(s, T + HOUR);
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      alpha: 3.5,
      learned: { 'pricing.viewed': { hits: 0, misses: 1 } },
      episodes: { hits: 0, misses: 1 },
      learnedAt: T + HOUR,
    });
    expect(s.episode).toStrictEqual({ startedAt: null, lastEventAt: null, intents: {} });
  });

  it('returns the same state when no episode is open', () => {
    const s = createState(config);
    expect(endEpisode(s, T)).toBe(s);
  });

  it('is neutral for signals seen after an outcome in the same episode', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'upgrade.completed', at: T + 1 });
    s = observe(s, { name: 'export.clicked', at: T + 2 });
    s = endEpisode(s, T + 3);
    assertInvariants(s);
    expect(s.intents.upgrade!.learned).toStrictEqual({ 'pricing.viewed': { hits: 1, misses: 0 } });
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 1, misses: 0 });
  });

  it('rejects a non-finite time', () => {
    const s = observe(createState(config), { name: 'pricing.viewed', at: T });
    expect(() => endEpisode(s, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('episodeTimeout', () => {
  const timed = upgradeConfig({ episodeTimeout: 30 * MINUTE });

  it('closes the idle episode before applying the next event', () => {
    let s = observe(createState(timed), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'limit.hit', at: T + HOUR });
    assertInvariants(s);
    expect(s.intents.upgrade).toMatchObject({
      learned: { 'pricing.viewed': { hits: 0, misses: 1 } },
      episodes: { hits: 0, misses: 1 },
      learnedAt: T + HOUR,
    });
    expect(s.episode).toStrictEqual({
      startedAt: T + HOUR,
      lastEventAt: T + HOUR,
      intents: { upgrade: { seen: ['limit.hit'], counts: { 'limit.hit': 1 }, resolved: false } },
    });
  });

  it('keeps the episode open across a gap shorter than the timeout', () => {
    let s = observe(createState(timed), { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'limit.hit', at: T + 29 * MINUTE });
    assertInvariants(s);
    expect(s.intents.upgrade!.learned).toStrictEqual({});
    expect(s.episode.intents.upgrade!.seen).toStrictEqual(['pricing.viewed', 'limit.hit']);
  });

  it('endEpisode after the timeout closes at the moment it timed out', () => {
    let s = observe(createState(timed), { name: 'pricing.viewed', at: T });
    s = endEpisode(s, T + DAY);
    assertInvariants(s);
    expect(s.intents.upgrade!.learnedAt).toBe(T + 30 * MINUTE);
  });
});

function patchIntent(
  base: EngineConfig,
  patch: Partial<EngineConfig['intents'][string]>,
): EngineConfig {
  return { ...base, intents: { upgrade: { ...base.intents.upgrade!, ...patch } } };
}
