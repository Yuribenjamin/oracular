import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type EngineConfig, validateConfig } from 'oracular';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, INTENT_KEYS, LEARNING_KEYS, MAX_MAGNITUDE, REVEAL_KEYS } from '../src/config';
import { clone, upgradeConfig } from './helpers';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = readFileSync(`${root}schema/config.schema.json`, 'utf8');

/** The subset of JSON Schema 2020-12 the config schema uses. */
interface Schema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string;
  required?: string[];
  additionalProperties?: boolean | Schema;
  properties?: Record<string, Schema>;
  propertyNames?: Schema;
  $defs?: Record<string, Schema>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  not?: { const?: unknown };
}

const schema = JSON.parse(text) as Schema;

/** Follows a `$ref` into `$defs`; keywords written next to the `$ref` win over the referenced ones. */
function resolve(node: Schema): Schema {
  if (node.$ref === undefined) return node;
  const target = schema.$defs?.[node.$ref.replace('#/$defs/', '')];
  if (target === undefined) throw new Error(`unresolved ${node.$ref}`);
  const local = Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref'));
  return { ...resolve(target), ...local };
}

const propertyKeys = (node: Schema) => Object.keys(resolve(node).properties ?? {}).sort();
const property = (node: Schema, key: string): Schema => {
  const value = resolve(node).properties?.[key];
  if (value === undefined) throw new Error(`schema has no property ${key}`);
  return value;
};

const intentSchema = resolve(property(schema, 'intents').additionalProperties as Schema);
const revealSchema = resolve(property(schema, 'reveal'));
const learningSchema = resolve(property(schema, 'learning'));
const weightSchema = resolve(property(intentSchema, 'signals').additionalProperties as Schema);

describe('the config JSON Schema', () => {
  it('is draft 2020-12 and lives where the docs site serves it', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://yuribenjamin.github.io/oracular/config.schema.json');
  });

  it('is published in the package and copied to the docs site, byte for byte', () => {
    expect(readFileSync(`${root}docs/public/config.schema.json`, 'utf8')).toBe(text);
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
    expect(pkg.exports['./config.schema.json']).toBe('./schema/config.schema.json');
    expect(pkg.files).toContain('schema');
  });

  it('declares exactly the keys the engine accepts, and rejects every other', () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toStrictEqual(['intents']);
    expect(propertyKeys(schema)).toStrictEqual(['$schema', ...CONFIG_KEYS].sort());

    expect(intentSchema.additionalProperties).toBe(false);
    expect(intentSchema.required).toStrictEqual(['prior', 'priorStrength', 'halfLife', 'signals']);
    expect(propertyKeys(intentSchema)).toStrictEqual([...INTENT_KEYS].sort());

    for (const reveal of [revealSchema, resolve(property(intentSchema, 'reveal'))]) {
      expect(reveal.additionalProperties).toBe(false);
      expect(propertyKeys(reveal)).toStrictEqual([...REVEAL_KEYS].sort());
    }
    expect(learningSchema.additionalProperties).toBe(false);
    expect(propertyKeys(learningSchema)).toStrictEqual([...LEARNING_KEYS].sort());
  });

  it('allows a $schema pointer that the engine itself rejects, so the CLI must drop it', () => {
    expect(property(schema, '$schema').type).toBe('string');
    expect(() => validateConfig({ ...upgradeConfig(), $schema: schema.$id })).toThrow(TypeError);
  });

  it('names intents and signals the way the engine does: non-empty, never __proto__', () => {
    for (const names of [
      property(schema, 'intents').propertyNames,
      property(intentSchema, 'signals').propertyNames,
    ]) {
      const rule = resolve(names as Schema);
      expect(rule.minLength).toBe(1);
      expect(rule.not).toStrictEqual({ const: '__proto__' });
    }
    expect(() => validateConfig({ intents: { '': upgradeConfig().intents.upgrade } })).toThrow(
      TypeError,
    );
    // An object literal would set the prototype; parsed JSON makes an own property named __proto__.
    const proto = JSON.parse(
      '{"intents":{"__proto__":{"prior":0.5,"priorStrength":1,"halfLife":1,"signals":{}}}}',
    );
    expect(() => validateConfig(proto)).toThrow(TypeError);
    const signal = JSON.parse(
      '{"intents":{"x":{"prior":0.5,"priorStrength":1,"halfLife":1,"signals":{"__proto__":1}}}}',
    );
    expect(() => validateConfig(signal)).toThrow(TypeError);
    expect(() =>
      validateConfig({
        intents: { x: { prior: 0.5, priorStrength: 1, halfLife: 1, signals: { '': 1 } } },
      }),
    ).toThrow(TypeError);
  });

  it('caps magnitudes where the engine does', () => {
    expect(resolve(property(intentSchema, 'priorStrength')).maximum).toBe(MAX_MAGNITUDE);
    expect(weightSchema.minimum).toBe(-MAX_MAGNITUDE);
    expect(weightSchema.maximum).toBe(MAX_MAGNITUDE);
  });

  /** A config with every optional section present, so each bound below can be probed in place. */
  type Full = EngineConfig & {
    episodeTimeout: number;
    learning: { halfLife: number; gain: number; priorEpisodes: number };
    reveal: { threshold: number; z: number; cooldown: number };
    intents: {
      upgrade: EngineConfig['intents'][string] & {
        reveal: Required<NonNullable<EngineConfig['intents'][string]['reveal']>>;
      };
    };
  };
  const base = (): Full =>
    clone({
      ...upgradeConfig(),
      episodeTimeout: 1,
      learning: { halfLife: 1, gain: 2, priorEpisodes: 10 },
      reveal: { threshold: 0.5, z: 1.28, cooldown: 1 },
      intents: {
        upgrade: {
          ...upgradeConfig().intents.upgrade,
          reveal: { threshold: 0.5, z: 1.28, cooldown: 1 },
        },
      },
    }) as Full;

  const intentReveal = resolve(property(intentSchema, 'reveal'));
  const numeric: { path: string; node: Schema; set: (config: Full, value: number) => void }[] = [
    {
      path: 'episodeTimeout',
      node: property(schema, 'episodeTimeout'),
      set: (c, v) => {
        c.episodeTimeout = v;
      },
    },
    {
      path: 'learning.halfLife',
      node: property(learningSchema, 'halfLife'),
      set: (c, v) => {
        c.learning.halfLife = v;
      },
    },
    {
      path: 'learning.gain',
      node: property(learningSchema, 'gain'),
      set: (c, v) => {
        c.learning.gain = v;
      },
    },
    {
      path: 'learning.priorEpisodes',
      node: property(learningSchema, 'priorEpisodes'),
      set: (c, v) => {
        c.learning.priorEpisodes = v;
      },
    },
    {
      path: 'reveal.threshold',
      node: property(revealSchema, 'threshold'),
      set: (c, v) => {
        c.reveal.threshold = v;
      },
    },
    {
      path: 'reveal.z',
      node: property(revealSchema, 'z'),
      set: (c, v) => {
        c.reveal.z = v;
      },
    },
    {
      path: 'reveal.cooldown',
      node: property(revealSchema, 'cooldown'),
      set: (c, v) => {
        c.reveal.cooldown = v;
      },
    },
    {
      path: 'intents.upgrade.prior',
      node: property(intentSchema, 'prior'),
      set: (c, v) => {
        c.intents.upgrade.prior = v;
      },
    },
    {
      path: 'intents.upgrade.priorStrength',
      node: property(intentSchema, 'priorStrength'),
      set: (c, v) => {
        c.intents.upgrade.priorStrength = v;
      },
    },
    {
      path: 'intents.upgrade.halfLife',
      node: property(intentSchema, 'halfLife'),
      set: (c, v) => {
        c.intents.upgrade.halfLife = v;
      },
    },
    {
      path: 'intents.upgrade.signals["pricing.viewed"]',
      node: weightSchema,
      set: (c, v) => {
        c.intents.upgrade.signals['pricing.viewed'] = v;
      },
    },
    {
      path: 'intents.upgrade.reveal.threshold',
      node: property(intentReveal, 'threshold'),
      set: (c, v) => {
        c.intents.upgrade.reveal.threshold = v;
      },
    },
    {
      path: 'intents.upgrade.reveal.z',
      node: property(intentReveal, 'z'),
      set: (c, v) => {
        c.intents.upgrade.reveal.z = v;
      },
    },
    {
      path: 'intents.upgrade.reveal.cooldown',
      node: property(intentReveal, 'cooldown'),
      set: (c, v) => {
        c.intents.upgrade.reveal.cooldown = v;
      },
    },
  ];

  describe('every numeric bound is exactly where the engine draws the line', () => {
    for (const { path, node, set } of numeric) {
      it(path, () => {
        const b = resolve(node);
        expect(b.type).toBe('number');
        const accepts = (value: number) => {
          const config = base();
          set(config, value);
          expect(
            () => validateConfig(config),
            `${path} = ${value} should be accepted`,
          ).not.toThrow();
        };
        const rejects = (value: number) => {
          const config = base();
          set(config, value);
          expect(() => validateConfig(config), `${path} = ${value} should be rejected`).toThrow(
            RangeError,
          );
        };
        const lo = b.minimum ?? b.exclusiveMinimum;
        const hi = b.maximum ?? b.exclusiveMaximum;
        expect(lo ?? hi, `${path} declares no bound`).toBeDefined();
        let inside =
          lo !== undefined && hi !== undefined
            ? (lo + hi) / 2
            : lo !== undefined
              ? lo + 1
              : (hi as number) - 1;
        if (b.not?.const === inside) inside += 1;
        accepts(inside);
        if (b.minimum !== undefined) {
          accepts(b.minimum);
          rejects(b.minimum - 1);
        }
        if (b.exclusiveMinimum !== undefined) rejects(b.exclusiveMinimum);
        if (b.maximum !== undefined) {
          accepts(b.maximum);
          rejects(b.maximum + 1);
        }
        if (b.exclusiveMaximum !== undefined) rejects(b.exclusiveMaximum);
        if (typeof b.not?.const === 'number') rejects(b.not.const);
      });
    }
  });
});
