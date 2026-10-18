import { readFileSync } from 'node:fs';
import {
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode,
  episodeClosed,
  evaluate,
  explain,
  observe,
  predict,
  STATE_VERSION,
  serialize,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { MAX_PENDING } from '../src/attribution';
import { decayFactor } from '../src/math';
import { assertInvariants, DAY, deepFreeze, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;
const SEVEN_DAYS = 7 * DAY;

/** The quickstart intent with a two-week attribution window and sessions that end after 30 idle minutes. */
function attributed(overrides: Partial<EngineConfig['intents'][string]> = {}): EngineConfig {
  const base = upgradeConfig({ episodeTimeout: 30 * MINUTE });
  return {
    ...base,
    intents: { upgrade: { ...base.intents.upgrade!, attribution: 14 * DAY, ...overrides } },
  };
}

const learned = (s: EngineState, signal: string) => s.intents.upgrade!.learned[signal];
const pending = (s: EngineState) => s.intents.upgrade!.pending;

/** Monday 10:00: pricing.viewed and limit.hit, session ended at 10:10. Nothing else that day. */
function monday(config: EngineConfig): EngineState {
  let s = createState(config);
  s = observe(s, { name: 'pricing.viewed', at: T });
  s = observe(s, { name: 'limit.hit', at: T + MINUTE });
  s = endEpisode(s, T + 10 * MINUTE);
  assertInvariants(s);
  return s;
}
const MONDAY_CLOSE = T + 10 * MINUTE;

describe('cross-episode attribution', () => {
  it('is off unless set: an episode that ends without the outcome is a miss at once', () => {
    const s = monday(upgradeConfig({ episodeTimeout: 30 * MINUTE }));
    expect(learned(s, 'pricing.viewed')).toStrictEqual({ hits: 0, misses: 1 });
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 1 });
    expect(pending(s)).toStrictEqual([]);
  });

  it('holds the closed episode instead: no miss yet, the episode waits with its signals', () => {
    const s = monday(attributed());
    expect(learned(s, 'pricing.viewed')).toBeUndefined();
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 0 });
    expect(pending(s)).toStrictEqual([
      { endedAt: MONDAY_CLOSE, seen: ['pricing.viewed', 'limit.hit'] },
    ]);
  });

  describe('the worked table: the upgrade arrives later, in a session of its own', () => {
    for (const [label, days] of [
      ['Tuesday', 1],
      ['Thursday', 3],
      ['next Monday', 7],
      ['two Mondays later', 14],
    ] as const) {
      it(`${label}: Monday's signals get 2^(−${days}d / 7d) of a hit and the rest of a miss`, () => {
        const at = MONDAY_CLOSE + days * DAY;
        let s = monday(attributed());
        s = observe(s, { name: 'export.clicked', at: at - MINUTE });
        s = observe(s, { name: 'upgrade.completed', at });
        assertInvariants(s);
        const c = decayFactor(at - MONDAY_CLOSE, SEVEN_DAYS);
        expect(c).toBeCloseTo(2 ** (-days / 7), 15);
        for (const signal of ['pricing.viewed', 'limit.hit']) {
          expect(learned(s, signal)!.hits).toBeCloseTo(c, 12);
          expect(learned(s, signal)!.misses).toBeCloseTo(1 - c, 12);
        }
        expect(learned(s, 'export.clicked')).toStrictEqual({ hits: 1, misses: 0 });
        // The base rate gets the same share, so both episodes still count exactly once.
        expect(s.intents.upgrade!.episodes.hits).toBeCloseTo(1 + c, 12);
        expect(s.intents.upgrade!.episodes.misses).toBeCloseTo(1 - c, 12);
        expect(pending(s)).toStrictEqual([]);
      });
    }

    it('the docs numbers: 0.906, 0.743, 0.5 and 0.25 for 1, 3, 7 and 14 days from the close', () => {
      const credits = [1, 3, 7, 14].map((days) => {
        let s = monday(attributed());
        s = observe(s, { name: 'upgrade.completed', at: MONDAY_CLOSE + days * DAY });
        return learned(s, 'pricing.viewed')!.hits;
      });
      expect(credits.map((c) => c.toFixed(3))).toStrictEqual(['0.906', '0.743', '0.500', '0.250']);
    });

    it('never: the window passes and the episode is a miss, recorded when the window ended', () => {
      const s = monday(attributed());
      // Touched one millisecond after the window: the miss lands.
      const next = observe(s, { name: 'export.clicked', at: MONDAY_CLOSE + 14 * DAY + 1 });
      assertInvariants(next);
      expect(learned(next, 'pricing.viewed')).toStrictEqual({ hits: 0, misses: 1 });
      expect(learned(next, 'limit.hit')).toStrictEqual({ hits: 0, misses: 1 });
      expect(next.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 1 });
      expect(pending(next)).toStrictEqual([]);
      // Exactly at the window's end the episode is still inside it.
      const edge = observe(s, { name: 'upgrade.completed', at: MONDAY_CLOSE + 14 * DAY });
      expect(learned(edge, 'pricing.viewed')!.hits).toBeCloseTo(0.25, 12);
    });
  });

  it('an outcome inside the window, with nothing seen in its own episode, still credits', () => {
    let s = monday(attributed());
    s = observe(s, { name: 'upgrade.completed', at: MONDAY_CLOSE + DAY });
    assertInvariants(s);
    expect(learned(s, 'pricing.viewed')!.hits).toBeCloseTo(2 ** (-1 / 7), 12);
    expect(s.intents.upgrade!.episodes.hits).toBeCloseTo(1 + 2 ** (-1 / 7), 12);
    expect(s.intents.upgrade!.lastOutcomeAt).toBe(MONDAY_CLOSE + DAY);
    // Evidence still resets as before: attribution touches learned counts only.
    expect(s.intents.upgrade!.contributions).toStrictEqual({});
  });

  it('several waiting episodes each get their own share, oldest first in the list', () => {
    let s = monday(attributed());
    s = observe(s, { name: 'export.clicked', at: MONDAY_CLOSE + DAY });
    s = endEpisode(s, MONDAY_CLOSE + DAY + MINUTE);
    expect(pending(s).map((e) => e.seen)).toStrictEqual([
      ['pricing.viewed', 'limit.hit'],
      ['export.clicked'],
    ]);
    const at = MONDAY_CLOSE + 3 * DAY;
    s = observe(s, { name: 'upgrade.completed', at });
    assertInvariants(s);
    expect(learned(s, 'pricing.viewed')!.hits).toBeCloseTo(decayFactor(3 * DAY, SEVEN_DAYS), 12);
    expect(learned(s, 'export.clicked')!.hits).toBeCloseTo(
      decayFactor(2 * DAY - MINUTE, SEVEN_DAYS),
      12,
    );
    expect(s.intents.upgrade!.episodes.hits).toBeCloseTo(
      1 + decayFactor(3 * DAY, SEVEN_DAYS) + decayFactor(2 * DAY - MINUTE, SEVEN_DAYS),
      12,
    );
    expect(pending(s)).toStrictEqual([]);
  });

  it('with learning.halfLife, a deferred miss is decayed from the end of the window, not from the close', () => {
    const config = attributed({ attribution: DAY });
    const withForgetting: EngineConfig = { ...config, learning: { halfLife: 30 * DAY } };
    const s = monday(withForgetting);
    const at = MONDAY_CLOSE + 3 * DAY;
    const next = observe(s, { name: 'export.clicked', at });
    assertInvariants(next);
    // The miss landed at MONDAY_CLOSE + 1 day and has decayed for two days since, not three.
    expect(learned(next, 'pricing.viewed')!.misses).toBeCloseTo(decayFactor(2 * DAY, 30 * DAY), 12);
    expect(next.intents.upgrade!.episodes.misses).toBeCloseTo(decayFactor(2 * DAY, 30 * DAY), 12);
    expect(next.intents.upgrade!.learnedAt).toBe(at);
  });

  it('reads settle an expired episode in what they show and store nothing', () => {
    const s = deepFreeze(monday(attributed({ attribution: DAY })));
    const at = MONDAY_CLOSE + 2 * DAY;
    const row = explain(s, 'upgrade', at).find((r) => r.signal === 'pricing.viewed')!;
    expect(row.misses).toBe(1);
    expect(
      evaluate(s, 'upgrade', at).explanation.find((r) => r.signal === 'pricing.viewed')!.misses,
    ).toBe(1);
    expect(predict(s, 'upgrade', at).p).toBeCloseTo(predict(s, 'upgrade', at).p, 12);
    expect(pending(s)).toHaveLength(1);
    // The effective weight a read shows is the one the next observe applies, on top of what
    // Monday's occurrence still contributes after two days of decay.
    const next = observe(s, { name: 'pricing.viewed', at });
    const applied = next.intents.upgrade!.contributions['pricing.viewed']!.alpha;
    expect(applied - row.contribution).toBeCloseTo(row.effectiveWeight, 12);
    expect(pending(next)).toStrictEqual([]);
  });

  it('a signal seen in a waiting episode still counts in the contrast once settled, not before', () => {
    const s = monday(attributed({ attribution: DAY }));
    const before = explain(s, 'upgrade', MONDAY_CLOSE + HOUR).find(
      (r) => r.signal === 'pricing.viewed',
    )!;
    expect([before.hits, before.misses]).toStrictEqual([0, 0]);
    expect(before.effectiveWeight).toBe(3);
    const after = explain(s, 'upgrade', MONDAY_CLOSE + 2 * DAY).find(
      (r) => r.signal === 'pricing.viewed',
    )!;
    expect([after.hits, after.misses]).toStrictEqual([0, 1]);
  });

  it('resolved episodes do not wait: signals seen after an outcome stay neutral at the close', () => {
    let s = monday(attributed());
    const at = MONDAY_CLOSE + DAY;
    s = observe(s, { name: 'upgrade.completed', at });
    s = observe(s, { name: 'export.clicked', at: at + MINUTE });
    s = endEpisode(s, at + 2 * MINUTE);
    assertInvariants(s);
    expect(pending(s)).toStrictEqual([]);
    expect(learned(s, 'export.clicked')).toBeUndefined();
  });

  it('every episode counts exactly once, whatever the mix of credits and misses', () => {
    let s = createState(attributed({ attribution: 3 * DAY }));
    let closed = 0;
    let resolved = 0;
    const signals = ['pricing.viewed', 'limit.hit', 'export.clicked'];
    for (let day = 0; day < 40; day++) {
      const at = T + day * DAY;
      s = observe(s, { name: signals[day % 3]!, at });
      if (day % 2 === 0) s = observe(s, { name: signals[(day + 1) % 3]!, at: at + MINUTE });
      if (day % 5 === 4) {
        s = observe(s, { name: 'upgrade.completed', at: at + 2 * MINUTE });
        resolved++;
      }
      s = endEpisode(s, at + 3 * MINUTE);
      assertInvariants(s);
      if (day % 5 !== 4) closed++;
    }
    // Settle everything still waiting, then count. The episode this last event opens stays open.
    s = observe(s, { name: 'export.clicked', at: T + 50 * DAY });
    assertInvariants(s);
    const { hits, misses } = s.intents.upgrade!.episodes;
    expect(hits + misses).toBeCloseTo(closed + resolved, 9);
    for (const signal of signals) {
      const r = learned(s, signal)!;
      expect(r.hits + r.misses).toBeCloseTo(Math.round(r.hits + r.misses), 9);
    }
    expect(pending(s)).toStrictEqual([]);
  });

  it(`holds at most ${MAX_PENDING} episodes: past that the oldest is a miss at once`, () => {
    let s = createState(attributed({ attribution: 365 * DAY }));
    for (let i = 0; i <= MAX_PENDING; i++) {
      const at = T + i * HOUR;
      s = observe(s, { name: 'pricing.viewed', at });
      s = endEpisode(s, at + MINUTE);
      assertInvariants(s);
    }
    expect(pending(s)).toHaveLength(MAX_PENDING);
    expect(pending(s)[0]!.endedAt).toBe(T + HOUR + MINUTE);
    expect(learned(s, 'pricing.viewed')).toStrictEqual({ hits: 0, misses: 1 });
    expect(s.intents.upgrade!.episodes).toStrictEqual({ hits: 0, misses: 1 });
  });

  it('a clock that goes backwards settles nothing and keeps the list in order of close', () => {
    let s = monday(attributed({ attribution: HOUR }));
    // An event dated before Monday's close: inside no window, and it opens an episode of its own.
    s = observe(s, { name: 'export.clicked', at: MONDAY_CLOSE - DAY });
    s = endEpisode(s, MONDAY_CLOSE - DAY + MINUTE);
    assertInvariants(s);
    expect(pending(s).map((e) => e.endedAt)).toStrictEqual([
      MONDAY_CLOSE - DAY + MINUTE,
      MONDAY_CLOSE,
    ]);
    expect(s.intents.upgrade!.episodes.misses).toBe(0);
    // Forward again, past both windows: both are misses.
    s = observe(s, { name: 'export.clicked', at: MONDAY_CLOSE + 2 * HOUR });
    assertInvariants(s);
    expect(s.intents.upgrade!.episodes.misses).toBe(2);
    expect(pending(s)).toStrictEqual([]);
  });

  it('episodeClosed is still true at the close, but the misses delta is 0 while the episode waits', () => {
    const config = attributed();
    let s = createState(config);
    s = observe(s, { name: 'pricing.viewed', at: T });
    const next = endEpisode(s, T + MINUTE);
    expect(episodeClosed(s, next)).toBe(true);
    expect(next.intents.upgrade!.episodes.misses - s.intents.upgrade!.episodes.misses).toBe(0);
    expect(pending(next)).toHaveLength(1);
  });

  describe('persistence', () => {
    it('round-trips waiting episodes losslessly', () => {
      const s = monday(attributed());
      const json = serialize(s);
      expect(json).toContain('"pending":[{"endedAt":');
      const back = deserialize(json, { config: attributed() });
      assertInvariants(back);
      expect(back).toStrictEqual(s);
      const at = MONDAY_CLOSE + DAY;
      expect(observe(back, { name: 'upgrade.completed', at })).toStrictEqual(
        observe(s, { name: 'upgrade.completed', at }),
      );
    });

    it("prunes a waiting episode's seen list to the declared signals and keeps the order of close", () => {
      const s = monday(attributed());
      const { 'limit.hit': _dropped, ...signals } = attributed().intents.upgrade!.signals;
      const next: EngineConfig = {
        ...attributed(),
        intents: { upgrade: { ...attributed().intents.upgrade!, signals } },
      };
      const tampered = JSON.parse(serialize(s));
      tampered.intents.upgrade.pending.unshift({
        endedAt: MONDAY_CLOSE + HOUR,
        seen: ['pricing.viewed', 'pricing.viewed', 'ghost'],
      });
      const back = deserialize(JSON.stringify(tampered), { config: next });
      assertInvariants(back);
      expect(pending(back)).toStrictEqual([
        { endedAt: MONDAY_CLOSE, seen: ['pricing.viewed'] },
        { endedAt: MONDAY_CLOSE + HOUR, seen: ['pricing.viewed'] },
      ]);
    });

    it('rejects malformed waiting episodes with the documented errors', () => {
      const valid = JSON.parse(serialize(monday(attributed())));
      const withPending = (pendingValue: unknown) =>
        JSON.stringify({
          ...valid,
          intents: { upgrade: { ...valid.intents.upgrade, pending: pendingValue } },
        });
      expect(() => deserialize(withPending({}))).toThrow(TypeError);
      expect(() => deserialize(withPending([{ seen: [] }]))).toThrow(TypeError);
      expect(() => deserialize(withPending([{ endedAt: T, seen: [1] }]))).toThrow(TypeError);
      expect(() => deserialize(withPending([{ endedAt: 'x', seen: [] }]))).toThrow(TypeError);
      expect(() =>
        deserialize(
          withPending(Array.from({ length: MAX_PENDING + 1 }, () => ({ endedAt: T, seen: [] }))),
        ),
      ).toThrow(RangeError);
      expect(() =>
        deserialize(
          withPending(Array.from({ length: MAX_PENDING }, () => ({ endedAt: T, seen: [] }))),
        ),
      ).not.toThrow();
    });

    it('a config without attribution settles leftover waiting episodes as misses at their close', () => {
      const s = monday(attributed());
      const plain = upgradeConfig({ episodeTimeout: 30 * MINUTE });
      const back = deserialize(serialize(s), { config: plain });
      assertInvariants(back);
      expect(pending(back)).toHaveLength(1);
      // A window of 0: the episode has waited long enough the moment anything happens after it.
      const next = observe(back, { name: 'export.clicked', at: MONDAY_CLOSE + 1 });
      assertInvariants(next);
      expect(learned(next, 'pricing.viewed')).toStrictEqual({ hits: 0, misses: 1 });
      expect(pending(next)).toStrictEqual([]);
    });

    it('migrates a version 2 state to version 3 with empty lists and the same numbers', () => {
      const text = readFileSync(new URL('./fixtures/state/0.4.0.json', import.meta.url), 'utf8');
      const stored = JSON.parse(text);
      expect(stored.version).toBe(2);
      const s = deserialize(text);
      assertInvariants(s);
      expect(s.version).toBe(STATE_VERSION);
      for (const [name, is] of Object.entries(s.intents)) {
        expect(is.pending).toStrictEqual([]);
        expect(is.learned).toStrictEqual(stored.intents[name].learned);
        expect(is.episodes).toStrictEqual(stored.intents[name].episodes);
      }
    });
  });
});
