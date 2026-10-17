import { createState, type EngineConfig, STATE_VERSION } from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, clone, DAY, deepFreeze, upgradeConfig } from './helpers';

describe('createState', () => {
  it('starts every intent at its prior with no open episode', () => {
    const state = createState(upgradeConfig());
    assertInvariants(state);
    expect(state.version).toBe(STATE_VERSION);
    expect(state.intents.upgrade).toMatchObject({
      alpha: 0.5,
      beta: 9.5,
      updatedAt: null,
      contributions: {},
      learned: {},
      episodes: { hits: 0, misses: 0 },
      lastRevealedAt: null,
      revealCount: 0,
    });
    expect(state.episode).toStrictEqual({ startedAt: null, lastEventAt: null, intents: {} });
  });

  it('keeps a detached, normalized copy of the config', () => {
    const config = upgradeConfig();
    const state = createState(config);
    expect(state.config).toStrictEqual(config);
    expect(state.config).not.toBe(config);
    config.intents.upgrade!.signals['pricing.viewed'] = 99;
    expect(state.config.intents.upgrade!.signals['pricing.viewed']).toBe(3);
  });

  it('does not mutate its input', () => {
    const config = deepFreeze(upgradeConfig());
    const before = clone(config);
    createState(config);
    expect(config).toStrictEqual(before);
  });

  it('drops keys whose value is undefined so the state survives JSON as-is', () => {
    // Plain-JS callers (or TS without exactOptionalPropertyTypes) can pass explicit undefined.
    const loose: unknown = {
      intents: {
        churn: {
          prior: 0.1,
          priorStrength: 5,
          halfLife: DAY,
          signals: { 'session.short': 1 },
          outcome: undefined,
          reveal: { threshold: undefined, z: 2 },
        },
      },
      episodeTimeout: undefined,
    };
    const state = createState(loose as EngineConfig);
    assertInvariants(state);
    expect(Object.keys(state.config)).toStrictEqual(['intents']);
    expect(Object.keys(state.config.intents.churn!)).toStrictEqual([
      'prior',
      'priorStrength',
      'halfLife',
      'signals',
      'reveal',
    ]);
    expect(state.config.intents.churn!.reveal).toStrictEqual({ z: 2 });
  });

  describe('rejects invalid config', () => {
    const base = () => upgradeConfig();
    const cases: Array<[string, () => unknown, ErrorConstructor]> = [
      ['no intents', () => ({ intents: {} }), TypeError],
      ['intents not an object', () => ({ intents: [] }), TypeError],
      ['unknown top-level key', () => ({ ...base(), halflife: 1 }), TypeError],
      ['unknown intent key', () => patch(base(), (i) => ({ ...i, halflife: 1 })), TypeError],
      ['prior 0', () => patch(base(), (i) => ({ ...i, prior: 0 })), RangeError],
      ['prior 1', () => patch(base(), (i) => ({ ...i, prior: 1 })), RangeError],
      ['prior NaN', () => patch(base(), (i) => ({ ...i, prior: Number.NaN })), TypeError],
      ['priorStrength 0', () => patch(base(), (i) => ({ ...i, priorStrength: 0 })), RangeError],
      ['halfLife 0', () => patch(base(), (i) => ({ ...i, halfLife: 0 })), RangeError],
      [
        'halfLife Infinity',
        () => patch(base(), (i) => ({ ...i, halfLife: Number.POSITIVE_INFINITY })),
        TypeError,
      ],
      ['halfLife as string', () => patch(base(), (i) => ({ ...i, halfLife: '7d' })), TypeError],
      ['signals missing', () => patch(base(), ({ signals: _s, ...i }) => i), TypeError],
      ['zero weight', () => patch(base(), (i) => ({ ...i, signals: { x: 0 } })), RangeError],
      ['NaN weight', () => patch(base(), (i) => ({ ...i, signals: { x: Number.NaN } })), TypeError],
      ['empty signal name', () => patch(base(), (i) => ({ ...i, signals: { '': 1 } })), TypeError],
      ['empty outcome', () => patch(base(), (i) => ({ ...i, outcome: '' })), TypeError],
      [
        'resetOnOutcome not boolean',
        () => patch(base(), (i) => ({ ...i, resetOnOutcome: 'yes' })),
        TypeError,
      ],
      [
        'threshold above 1',
        () => patch(base(), (i) => ({ ...i, reveal: { threshold: 1.5 } })),
        RangeError,
      ],
      ['negative z', () => ({ ...base(), reveal: { z: -1 } }), RangeError],
      ['negative cooldown', () => ({ ...base(), reveal: { cooldown: -1 } }), RangeError],
      ['unknown reveal key', () => ({ ...base(), reveal: { treshold: 0.5 } }), TypeError],
      ['episodeTimeout 0', () => ({ ...base(), episodeTimeout: 0 }), RangeError],
      [
        'learning.priorEpisodes 0',
        () => ({ ...base(), learning: { priorEpisodes: 0 } }),
        RangeError,
      ],
      ['learning.gain negative', () => ({ ...base(), learning: { gain: -2 } }), RangeError],
      ['learning.halfLife 0', () => ({ ...base(), learning: { halfLife: 0 } }), RangeError],
      ['null config', () => null, TypeError],
    ];

    for (const [label, make, ErrorType] of cases) {
      it(label, () => {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
        expect(() => createState(make() as any)).toThrow(ErrorType);
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
        expect(() => createState(make() as any)).toThrow(/^oracular: /);
      });
    }
  });
});

function patch(
  config: ReturnType<typeof upgradeConfig>,
  fn: (intent: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  return { ...config, intents: { upgrade: fn({ ...config.intents.upgrade }) } };
}
