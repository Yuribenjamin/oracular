import {
  createEndRecord,
  createRecord,
  createState,
  deserialize,
  endEpisode,
  episodeClosed,
  evaluate,
  evidenceToReveal,
  explain,
  markRevealed,
  ms,
  observe,
  predict,
  serialize,
  shouldReveal,
  validateConfig,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { clone, deepFreeze, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

/** Freezes the arguments, calls twice, and checks both results agree and the inputs are untouched. */
function pure<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R {
  deepFreeze(args);
  const before = clone(args);
  const first = fn(...args);
  const second = fn(...args);
  expect(second).toStrictEqual(first);
  expect(args).toStrictEqual(before);
  return first;
}

describe('purity', () => {
  it('createState', () => {
    pure(createState, upgradeConfig());
  });

  it('observe: signal, outcome, unknown event, and with props', () => {
    const s0 = pure(createState, upgradeConfig({ episodeTimeout: 10 * MINUTE }));
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    const s2 = pure(observe, s1, { name: 'noise', at: T + 1, props: { a: [1] } });
    const s3 = pure(observe, s2, { name: 'upgrade.completed', at: T + 2 });
    pure(observe, s3, { name: 'limit.hit', at: T + 20 * MINUTE });
  });

  it('endEpisode', () => {
    const s0 = pure(createState, upgradeConfig());
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    pure(endEpisode, s1, T + MINUTE);
    pure(endEpisode, s0, T);
  });

  it('predict, shouldReveal and markRevealed', () => {
    const s0 = pure(createState, upgradeConfig());
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    pure(predict, s1, 'upgrade', T + MINUTE);
    pure(predict, s1, 'upgrade', T + MINUTE, { z: 2, threshold: 0.3 });
    pure(shouldReveal, s1, 'upgrade', T + MINUTE);
    pure(shouldReveal, s1, 'upgrade', T + MINUTE, { threshold: 0.1, z: 0 });
    const s2 = pure(markRevealed, s1, 'upgrade', T + MINUTE);
    pure(predict, s2, 'upgrade', T + 2 * MINUTE);
  });

  it('explain', () => {
    const s0 = pure(createState, upgradeConfig());
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    const s2 = pure(observe, s1, { name: 'plan.downgraded', at: T });
    pure(explain, s2, 'upgrade', T + MINUTE);
    pure(explain, s0, 'upgrade', T);
  });

  it('serialize and deserialize', () => {
    const s0 = pure(createState, upgradeConfig());
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    const json = pure(serialize, s1);
    pure(deserialize, json);
    pure(deserialize, json, { config: upgradeConfig({ episodeTimeout: MINUTE }) });
  });

  it('createRecord and createEndRecord', () => {
    const s0 = pure(createState, upgradeConfig());
    const event = { name: 'pricing.viewed', at: T, props: { plan: 'pro' } };
    const s1 = pure(observe, s0, event);
    pure(createRecord, s1, event, { installId: 'install-1', mode: 'shadow' });
    pure(createRecord, s1, event, { installId: 'install-1', mode: 'live', top: 1 });
    pure(createEndRecord, T + MINUTE, { installId: 'install-1', mode: 'shadow' });
  });

  it('evaluate, evidenceToReveal and episodeClosed', () => {
    const s0 = pure(createState, upgradeConfig({ episodeTimeout: MINUTE }));
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    pure(evaluate, s1, 'upgrade', T + MINUTE);
    pure(evaluate, s1, 'upgrade', T + MINUTE, { z: 2, nonZero: true, limit: 2 });
    pure(evidenceToReveal, upgradeConfig().intents.upgrade!);
    pure(evidenceToReveal, upgradeConfig().intents.upgrade!, { threshold: 0.7, z: 1.64 });
    const s2 = pure(endEpisode, s1, T + 2 * MINUTE);
    pure(episodeClosed, s1, s2);
  });

  it('observe and endEpisode with attribution: an episode waits, the outcome credits it', () => {
    const config = upgradeConfig({ episodeTimeout: 10 * MINUTE });
    const attributed = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, attribution: 14 * 24 * 60 * MINUTE } },
    };
    const s0 = pure(createState, attributed);
    const s1 = pure(observe, s0, { name: 'pricing.viewed', at: T });
    const s2 = pure(endEpisode, s1, T + MINUTE);
    pure(explain, s2, 'upgrade', T + 20 * 24 * 60 * MINUTE);
    const s3 = pure(observe, s2, { name: 'upgrade.completed', at: T + 60 * MINUTE });
    pure(observe, s2, { name: 'limit.hit', at: T + 20 * 24 * 60 * MINUTE });
    pure(deserialize, pure(serialize, s2), { config: attributed });
    pure(serialize, s3);
  });

  it('validateConfig and ms', () => {
    pure(validateConfig, upgradeConfig({ episodeTimeout: 10 * MINUTE, reveal: { z: 1.64 } }));
    pure(ms.days, 7);
    pure(ms.minutes, 1.5);
  });
});
