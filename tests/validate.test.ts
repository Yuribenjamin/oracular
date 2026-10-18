import { createState, type EngineConfig, validateConfig } from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertPlainJson, clone, deepFreeze, MINUTE, upgradeConfig } from './helpers';

describe('validateConfig', () => {
  it('returns exactly the normalized copy createState stores', () => {
    const config = upgradeConfig({
      episodeTimeout: 30 * MINUTE,
      learning: { priorEpisodes: 5 },
      reveal: { z: 1.64 },
    });
    expect(validateConfig(config)).toStrictEqual(createState(config).config);
  });

  it('keeps only recognised keys with defined values, in a fixed order, as plain JSON', () => {
    const messy = {
      reveal: { z: 1.64, threshold: undefined },
      intents: {
        upgrade: {
          outcome: 'upgrade.completed',
          signals: { 'pricing.viewed': 3 },
          halfLife: 7,
          saturate: undefined,
          priorStrength: 10,
          prior: 0.05,
        },
      },
      episodeTimeout: undefined,
    };
    const out = validateConfig(messy);
    expect(Object.keys(out)).toStrictEqual(['intents', 'reveal']);
    expect(Object.keys(out.intents.upgrade as EngineConfig['intents'][string])).toStrictEqual([
      'prior',
      'priorStrength',
      'halfLife',
      'signals',
      'outcome',
    ]);
    expect(out.reveal).toStrictEqual({ z: 1.64 });
    assertPlainJson(out, 'config');
    expect(JSON.parse(JSON.stringify(out))).toStrictEqual(out);
    // Two configs that differ only in key order and undefined values normalize to the same text.
    expect(JSON.stringify(out)).toBe(
      JSON.stringify(validateConfig(JSON.parse(JSON.stringify(out)))),
    );
  });

  it('returns a fresh copy and never touches the input', () => {
    const config = upgradeConfig({ episodeTimeout: MINUTE });
    const before = clone(config);
    const out = validateConfig(deepFreeze(config));
    expect(out).not.toBe(config);
    expect(out.intents).not.toBe(config.intents);
    expect(out.intents.upgrade?.signals).not.toBe(config.intents.upgrade?.signals);
    expect(config).toStrictEqual(before);
    // The copy is the caller's: mutating it changes nothing else.
    (out.intents.upgrade as EngineConfig['intents'][string]).prior = 0.5;
    expect(config.intents.upgrade?.prior).toBe(0.05);
  });

  it('throws the same error, type and message, as createState', () => {
    const bad: unknown[] = [
      null,
      [],
      { intents: {} },
      { intents: { upgrade: { prior: 0, priorStrength: 10, halfLife: 7, signals: {} } } },
      { intents: { upgrade: { prior: 0.5, priorStrength: 10, halfLife: 7, signals: { x: 0 } } } },
      {
        intents: { upgrade: { prior: 0.5, priorStrength: 10, halfLife: 7, signals: {}, nope: 1 } },
      },
      { ...upgradeConfig(), episodeTimeout: -1 },
      { ...upgradeConfig(), learning: { gain: 1e7 } },
      { ...upgradeConfig(), $schema: 'https://yuribenjamin.github.io/oracular/config.schema.json' },
    ];
    for (const config of bad) {
      let fromCreate: unknown;
      try {
        createState(config as EngineConfig);
      } catch (error) {
        fromCreate = error;
      }
      expect(fromCreate, JSON.stringify(config)).toBeInstanceOf(Error);
      let fromValidate: unknown;
      try {
        validateConfig(config);
      } catch (error) {
        fromValidate = error;
      }
      expect(fromValidate, JSON.stringify(config)).toBeInstanceOf(Error);
      const a = fromCreate as Error;
      const b = fromValidate as Error;
      expect(b.constructor).toBe(a.constructor);
      expect(b.message).toBe(a.message);
      expect(b.message).toMatch(/^oracular: config/);
    }
  });

  it('names the offending path', () => {
    expect(() => validateConfig({ ...upgradeConfig(), learning: { gain: 0 } })).toThrow(
      new RangeError('oracular: config.learning.gain must be greater than 0'),
    );
    expect(() =>
      validateConfig({
        intents: { upgrade: { prior: 0.5, priorStrength: 10, halfLife: 7, signals: { x: '3' } } },
      }),
    ).toThrow(
      new TypeError('oracular: config.intents["upgrade"].signals["x"] must be a finite number'),
    );
  });

  it('accepts parsed JSON, typed unknown', () => {
    const text = JSON.stringify(upgradeConfig({ episodeTimeout: MINUTE }));
    const parsed: unknown = JSON.parse(text);
    const out = validateConfig(parsed);
    expect(out).toStrictEqual(createState(out).config);
  });
});
