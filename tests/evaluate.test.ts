import {
  createState,
  type EngineState,
  endEpisode,
  evaluate,
  explain,
  markRevealed,
  observe,
  predict,
  shouldReveal,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

/** A few states at different points of a life cycle. */
function scenarios(): Array<[string, EngineState]> {
  const config = upgradeConfig({ episodeTimeout: 30 * MINUTE, learning: { halfLife: 30 * DAY } });
  const fresh = createState(config);
  let s = fresh;
  s = observe(s, { name: 'pricing.viewed', at: T });
  s = observe(s, { name: 'limit.hit', at: T + MINUTE });
  const warm = s;
  s = observe(s, { name: 'upgrade.completed', at: T + 2 * MINUTE });
  s = endEpisode(s, T + 3 * MINUTE);
  const afterOutcome = s;
  for (let i = 0; i < 6; i++) s = observe(s, { name: 'pricing.viewed', at: T + 10 * DAY });
  const hot = s;
  const revealed = markRevealed(s, 'upgrade', T + 10 * DAY);
  for (const state of [fresh, warm, afterOutcome, hot, revealed]) assertInvariants(state);
  return [
    ['fresh', fresh],
    ['warm', warm],
    ['afterOutcome', afterOutcome],
    ['hot', hot],
    ['revealed', revealed],
  ];
}

describe('evaluate', () => {
  it('returns exactly what predict, shouldReveal and explain return, at several times and options', () => {
    for (const [label, s] of scenarios()) {
      for (const at of [T, T + HOUR, T + 10 * DAY, T + 10 * DAY + HOUR, T + 60 * DAY]) {
        for (const opts of [
          undefined,
          { threshold: 0.3 },
          { z: 0, cooldown: 0 },
          { threshold: 0.6, z: 2 },
        ]) {
          const e = evaluate(s, 'upgrade', at, opts);
          expect(e.prediction, `${label} prediction @${at}`).toStrictEqual(
            predict(s, 'upgrade', at, opts),
          );
          expect(e.reveal, `${label} reveal @${at}`).toBe(shouldReveal(s, 'upgrade', at, opts));
          expect(e.explanation, `${label} explanation @${at}`).toStrictEqual(
            explain(s, 'upgrade', at),
          );
        }
      }
    }
  });

  it('passes explain filters through and keeps them out of the reveal decision', () => {
    const [, , , hot] = scenarios();
    const s = hot![1];
    const e = evaluate(s, 'upgrade', T + 10 * DAY, { nonZero: true, limit: 1, z: 0 });
    expect(e.explanation).toStrictEqual(
      explain(s, 'upgrade', T + 10 * DAY, { nonZero: true, limit: 1 }),
    );
    expect(e.explanation).toHaveLength(1);
    expect(e.prediction).toStrictEqual(predict(s, 'upgrade', T + 10 * DAY, { z: 0 }));
    expect(e.reveal).toBe(shouldReveal(s, 'upgrade', T + 10 * DAY, { z: 0 }));
  });

  it('does not change the stored state', () => {
    const [, , , hot] = scenarios();
    const s = hot![1];
    const snapshot = structuredClone(s);
    evaluate(s, 'upgrade', T + 40 * DAY, { nonZero: true });
    expect(s).toStrictEqual(snapshot);
  });

  it('rejects unknown intents, bad times and malformed options', () => {
    const s = createState(upgradeConfig());
    expect(() => evaluate(s, 'nope', T)).toThrow(RangeError);
    expect(() => evaluate(s, 'upgrade', Number.NaN)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => evaluate(s, 'upgrade', T, { treshold: 0.5 } as any)).toThrow(TypeError);
    expect(() => evaluate(s, 'upgrade', T, { threshold: 2 })).toThrow(RangeError);
    expect(() => evaluate(s, 'upgrade', T, { limit: -1 })).toThrow(RangeError);
    expect(() => evaluate(s, 'upgrade', T, { limit: 1.5 })).toThrow(RangeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => evaluate(s, 'upgrade', T, { nonZero: 'yes' } as any)).toThrow(TypeError);
  });
});
