import {
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode,
  explain,
  markRevealed,
  observe,
  predict,
  STATE_VERSION,
  serialize,
} from 'oracular';
import { describe, expect, it, vi } from 'vitest';
import { priorCounts } from '../src/intent';
import { assertInvariants, DAY, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;
const config = upgradeConfig({ episodeTimeout: 30 * MINUTE });

/** A state with evidence, learned data, an open episode and a reveal on record. */
function busyState(): EngineState {
  let s = createState(config);
  for (let i = 0; i < 5; i++) {
    const at = T + i * DAY;
    s = observe(s, { name: 'pricing.viewed', at });
    s = observe(s, { name: 'limit.hit', at: at + MINUTE });
    s = observe(s, { name: 'upgrade.completed', at: at + 2 * MINUTE });
    s = endEpisode(s, at + 3 * MINUTE);
    s = observe(s, { name: 'export.clicked', at: at + HOUR });
    s = endEpisode(s, at + HOUR + MINUTE);
  }
  s = observe(s, { name: 'pricing.viewed', at: T + 10 * DAY });
  s = observe(s, { name: 'plan.downgraded', at: T + 10 * DAY });
  s = markRevealed(s, 'upgrade', T + 10 * DAY);
  assertInvariants(s);
  return s;
}

function load(json: string, opts?: Parameters<typeof deserialize>[1]): EngineState {
  const state = deserialize(json, opts);
  assertInvariants(state);
  return state;
}

describe('serialize / deserialize', () => {
  it('round-trips a fresh state losslessly', () => {
    const s = createState(config);
    const json = serialize(s);
    expect(JSON.parse(json).version).toBe(STATE_VERSION);
    expect(load(json)).toStrictEqual(s);
    expect(serialize(load(json))).toBe(json);
  });

  it('round-trips a busy state losslessly and keeps behaving identically', () => {
    const s = busyState();
    const json = serialize(s);
    const back = load(json);
    expect(back).toStrictEqual(s);
    expect(serialize(back)).toBe(json);

    const at = T + 11 * DAY;
    expect(predict(back, 'upgrade', at)).toStrictEqual(predict(s, 'upgrade', at));
    expect(explain(back, 'upgrade', at)).toStrictEqual(explain(s, 'upgrade', at));
    const event = { name: 'limit.hit', at };
    expect(observe(back, event)).toStrictEqual(observe(s, event));
  });

  it('never stores event props', () => {
    let s = createState(config);
    s = observe(s, {
      name: 'pricing.viewed',
      at: T,
      props: { secret: 'hunter2', nested: { token: 'tok_abc' }, list: ['pii@example.com'] },
    });
    s = observe(s, { name: 'unknown.event', at: T, props: { secret: 'hunter2' } });
    s = observe(s, { name: 'upgrade.completed', at: T, props: { secret: 'hunter2' } });
    const json = serialize(s);
    for (const needle of [
      'secret',
      'hunter2',
      'nested',
      'token',
      'tok_abc',
      'list',
      'pii@example.com',
      'props',
    ]) {
      expect(json).not.toContain(needle);
    }
    expect(json).not.toContain('unknown.event');
  });

  it('rejects other versions unless a migrate function is given, and uses its result', () => {
    const s = busyState();
    const old = JSON.stringify({ ...JSON.parse(serialize(s)), version: 0, legacy: true });

    expect(() => deserialize(old)).toThrow(RangeError);
    expect(() => deserialize(old)).toThrow(/version 0/);

    const migrate = vi.fn((stored: unknown, version: number) => {
      expect(version).toBe(0);
      expect((stored as { legacy: boolean }).legacy).toBe(true);
      const { legacy: _legacy, ...rest } = stored as Record<string, unknown>;
      return { ...rest, version: STATE_VERSION } as EngineState;
    });
    expect(load(old, { migrate })).toStrictEqual(s);
    expect(migrate).toHaveBeenCalledTimes(1);

    // The current version never calls migrate.
    const current = vi.fn();
    load(serialize(s), { migrate: current });
    expect(current).not.toHaveBeenCalled();

    // A migration that does not produce the current version is an error.
    expect(() => deserialize(old, { migrate: () => JSON.parse(old) })).toThrow(RangeError);
  });

  it('rejects garbage', () => {
    const s = createState(config);
    const valid = JSON.parse(serialize(s));
    const upgrade = valid.intents.upgrade;
    const broken: Array<[string, unknown, ErrorConstructor]> = [
      ['empty object', {}, TypeError],
      ['array', [], TypeError],
      ['string version', { ...valid, version: '1' }, TypeError],
      ['missing config', { version: 1, intents: {}, episode: valid.episode }, TypeError],
      ['invalid config', { ...valid, config: { intents: {} } }, TypeError],
      ['null alpha', { ...valid, intents: { upgrade: { ...upgrade, alpha: null } } }, TypeError],
      [
        'negative hits',
        {
          ...valid,
          intents: { upgrade: { ...upgrade, learned: { 'limit.hit': { hits: -1, misses: 0 } } } },
        },
        RangeError,
      ],
      [
        'negative contribution',
        {
          ...valid,
          intents: {
            upgrade: { ...upgrade, contributions: { 'limit.hit': { alpha: -1, beta: 0 } } },
          },
        },
        RangeError,
      ],
      [
        'fractional revealCount',
        { ...valid, intents: { upgrade: { ...upgrade, revealCount: 1.5 } } },
        RangeError,
      ],
      [
        'seen not strings',
        {
          ...valid,
          episode: {
            startedAt: T,
            lastEventAt: T,
            intents: { upgrade: { seen: [1], resolved: false } },
          },
        },
        TypeError,
      ],
      ['missing episode', { version: 1, config: valid.config, intents: valid.intents }, TypeError],
    ];
    for (const [label, value, ErrorType] of broken) {
      expect(() => deserialize(JSON.stringify(value)), label).toThrow(ErrorType);
    }
    expect(() => deserialize('not json')).toThrow(SyntaxError);
    expect(() => deserialize('null')).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => deserialize(42 as any)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => deserialize(serialize(s), { migrate: 'nope' } as any)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => deserialize(serialize(s), { cfg: config } as any)).toThrow(TypeError);
  });

  it('rejects finite numbers too large to compute with, instead of answering NaN', () => {
    const valid = JSON.parse(serialize(busyState()));
    const huge = structuredClone(valid);
    huge.intents.upgrade.contributions['pricing.viewed'] = { alpha: 1e308, beta: 0 };
    // Each number is finite, but α·β overflows and the Beta variance would be NaN.
    expect(() => deserialize(JSON.stringify(huge))).toThrow(RangeError);
    expect(() => deserialize(JSON.stringify(huge))).toThrow(/more evidence than can be computed/);

    const counts = structuredClone(valid);
    counts.intents.upgrade.episodes = { hits: 1e308, misses: 1e308 };
    // The contrast weighting nWith·nWithout / (nWith + nWithout) overflows to NaN.
    expect(() => deserialize(JSON.stringify(counts))).toThrow(RangeError);
    expect(() => deserialize(JSON.stringify(counts))).toThrow(/too large to compute with/);

    // Large but computable counts still load.
    const large = structuredClone(valid);
    large.intents.upgrade.episodes = { hits: 1e9, misses: 1e9 };
    assertInvariants(deserialize(JSON.stringify(large)));
  });

  it('prunes undeclared signals and intents found in stored data', () => {
    const s = busyState();
    const tampered = JSON.parse(serialize(s));
    tampered.intents.upgrade.contributions['old.signal'] = { alpha: 7, beta: 0 };
    tampered.intents.upgrade.alpha += 7;
    tampered.intents.upgrade.learned['old.signal'] = { hits: 3, misses: 1 };
    tampered.intents.upgrade.extraField = 'ignored';
    tampered.intents.ghost = tampered.intents.upgrade;
    tampered.episode.intents.upgrade.seen.push('old.signal');
    tampered.episode.intents.upgrade.counts['old.signal'] = 2;
    tampered.episode.intents.ghost = { seen: [], counts: {}, resolved: false };
    expect(load(JSON.stringify(tampered))).toStrictEqual(s);
  });
});

describe('deserialize with the current config', () => {
  it('is a plain round trip when the config is unchanged', () => {
    const s = busyState();
    expect(load(serialize(s), { config })).toStrictEqual(s);
  });

  it('replaces the stored snapshot and keeps everything learned when only weights change', () => {
    const s = busyState();
    const next: EngineConfig = {
      ...config,
      intents: {
        upgrade: {
          ...config.intents.upgrade!,
          signals: { ...config.intents.upgrade!.signals, 'limit.hit': 5 },
        },
      },
    };
    const back = load(serialize(s), { config: next });
    expect(back.config).toStrictEqual(next);
    expect(back.config).not.toStrictEqual(s.config);
    expect(back.intents).toStrictEqual(s.intents);
    expect(back.episode).toStrictEqual(s.episode);
    expect(
      explain(back, 'upgrade', T + 10 * DAY).find((r) => r.signal === 'limit.hit')!.initialWeight,
    ).toBe(5);
  });

  it('drops a removed signal everywhere and recomputes α and β', () => {
    const s = busyState();
    const { 'plan.downgraded': _dropped, ...signals } = config.intents.upgrade!.signals;
    const next: EngineConfig = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, signals } },
    };
    const back = load(serialize(s), { config: next });

    const before = s.intents.upgrade!;
    const after = back.intents.upgrade!;
    expect(after.contributions).not.toHaveProperty('plan.downgraded');
    expect(after.learned).not.toHaveProperty('plan.downgraded');
    expect(back.episode.intents.upgrade!.seen).toStrictEqual(['pricing.viewed']);
    expect(after.alpha).toBeCloseTo(before.alpha, 12);
    expect(after.beta).toBeCloseTo(before.beta - before.contributions['plan.downgraded']!.beta, 12);
    expect(predict(back, 'upgrade', T + 10 * DAY).p).toBeGreaterThan(
      predict(s, 'upgrade', T + 10 * DAY).p,
    );
  });

  it('applies a changed prior to α and β while keeping the contributions', () => {
    const s = busyState();
    const next: EngineConfig = {
      ...config,
      intents: { upgrade: { ...config.intents.upgrade!, prior: 0.2, priorStrength: 20 } },
    };
    const back = load(serialize(s), { config: next });
    const before = s.intents.upgrade!;
    const after = back.intents.upgrade!;
    const { alpha0, beta0 } = priorCounts(next.intents.upgrade!);
    expect(after.contributions).toStrictEqual(before.contributions);
    let sumAlpha = 0;
    let sumBeta = 0;
    for (const c of Object.values(before.contributions)) {
      sumAlpha += c.alpha;
      sumBeta += c.beta;
    }
    expect(after.alpha).toBeCloseTo(alpha0 + sumAlpha, 12);
    expect(after.beta).toBeCloseTo(beta0 + sumBeta, 12);
  });

  it('drops removed intents and starts new ones at their prior', () => {
    const s = busyState();
    const next: EngineConfig = {
      ...config,
      intents: {
        churn: { prior: 0.1, priorStrength: 5, halfLife: DAY, signals: { 'session.short': 1 } },
      },
    };
    const back = load(serialize(s), { config: next });
    expect(Object.keys(back.intents)).toStrictEqual(['churn']);
    expect(back.intents.churn).toMatchObject({
      alpha: 0.5,
      beta: 4.5,
      contributions: {},
      learned: {},
    });
    expect(back.episode.intents).toStrictEqual({});
    expect(back.episode.startedAt).toBe(s.episode.startedAt);
    expect(() => predict(back, 'upgrade', T)).toThrow(RangeError);
    expect(predict(back, 'churn', T).p).toBeCloseTo(0.1, 12);
  });

  it('rejects an invalid config before touching anything', () => {
    const json = serialize(busyState());
    expect(() => deserialize(json, { config: { intents: {} } })).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => deserialize(json, { config: { intents: { x: { prior: 2 } } } as any })).toThrow();
  });
});
