import { createState, type EngineConfig, endEpisode, observe } from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const config = upgradeConfig();
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
    expect(s.episode.intents.upgrade).toStrictEqual({ seen: ['pricing.viewed'], resolved: false });

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

  it('counts a repeated signal twice but remembers it once per episode', () => {
    let s = observe(createState(config), { name: 'limit.hit', at: T });
    s = observe(s, { name: 'limit.hit', at: T });
    assertInvariants(s);
    expect(s.intents.upgrade!.contributions['limit.hit']).toStrictEqual({ alpha: 4, beta: 0 });
    expect(s.episode.intents.upgrade!.seen).toStrictEqual(['limit.hit']);
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
    expect(s.episode.intents.upgrade).toStrictEqual({ seen: [], resolved: true });
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
      intents: { upgrade: { seen: ['limit.hit'], resolved: false } },
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
