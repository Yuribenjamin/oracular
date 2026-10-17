import { createState, type EngineState, endEpisode, explain, observe, predict } from 'oracular';
import { describe, expect, it } from 'vitest';
import { decayIntent, priorCounts } from '../src/intent';
import { assertInvariants, DAY, MINUTE, upgradeConfig } from './helpers';

const config = upgradeConfig();
const intent = config.intents.upgrade!;
const T = 1_700_000_000_000;

function withEvidence(): EngineState {
  let s = createState(config);
  s = observe(s, { name: 'pricing.viewed', at: T });
  s = observe(s, { name: 'limit.hit', at: T });
  s = observe(s, { name: 'plan.downgraded', at: T });
  assertInvariants(s);
  return s;
}

/** Σ signed contributions must equal (α − α0) − (β − β0) for the state decayed to `at`. */
function expectSumMatches(state: EngineState, at: number): void {
  const is = decayIntent(state.intents.upgrade!, intent, at);
  const { alpha0, beta0 } = priorCounts(intent);
  const sum = explain(state, 'upgrade', at).reduce((acc, e) => acc + e.contribution, 0);
  expect(Math.abs(sum - (is.alpha - alpha0 - (is.beta - beta0)))).toBeLessThanOrEqual(1e-9);
}

describe('explain', () => {
  it('lists every declared signal, strongest impact first, ties by name', () => {
    const rows = explain(withEvidence(), 'upgrade', T);
    expect(rows.map((r) => r.signal).sort()).toStrictEqual(Object.keys(intent.signals).sort());
    const sorted = [...rows].sort(
      (a, b) => Math.abs(b.impact) - Math.abs(a.impact) || a.signal.localeCompare(b.signal),
    );
    expect(rows).toStrictEqual(sorted);
    // Impact is nonlinear in p: with p below 0.5, the +3 signal moves it more than the -4 one.
    expect(rows[0]!.signal).toBe('pricing.viewed');
    expect(rows.at(-1)).toStrictEqual({
      signal: 'export.clicked',
      contribution: 0,
      impact: 0,
      initialWeight: 1,
      learnedWeight: 0,
      effectiveWeight: 1,
      hits: 0,
      misses: 0,
    });

    const fresh = explain(createState(config), 'upgrade', T);
    expect(fresh.map((r) => r.signal)).toStrictEqual([
      'export.clicked',
      'limit.hit',
      'plan.downgraded',
      'pricing.viewed',
    ]);
  });

  it('reports signed contributions whose sum matches α and β within 1e-9', () => {
    const s = withEvidence();
    const byName = Object.fromEntries(explain(s, 'upgrade', T).map((r) => [r.signal, r]));
    expect(byName['pricing.viewed']!.contribution).toBe(3);
    expect(byName['limit.hit']!.contribution).toBe(2);
    expect(byName['plan.downgraded']!.contribution).toBe(-4);
    expectSumMatches(s, T);
    expectSumMatches(s, T + 3 * DAY);
    expectSumMatches(s, T + 100 * DAY);
  });

  it('impact is p minus p without the signal, and shares the sign of the contribution', () => {
    const s = withEvidence();
    const { p } = predict(s, 'upgrade', T);
    const is = s.intents.upgrade!;
    for (const row of explain(s, 'upgrade', T)) {
      const c = is.contributions[row.signal] ?? { alpha: 0, beta: 0 };
      const without = (is.alpha - c.alpha) / (is.alpha - c.alpha + (is.beta - c.beta));
      expect(row.impact).toBeCloseTo(p - without, 12);
      expect(Math.sign(row.impact)).toBe(Math.sign(row.contribution));
    }
  });

  it('decays contributions to the asked time', () => {
    const s = withEvidence();
    const now = Object.fromEntries(explain(s, 'upgrade', T).map((r) => [r.signal, r]));
    const later = Object.fromEntries(explain(s, 'upgrade', T + 7 * DAY).map((r) => [r.signal, r]));
    expect(later['pricing.viewed']!.contribution).toBeCloseTo(1.5, 12);
    expect(later['plan.downgraded']!.contribution).toBeCloseTo(-2, 12);
    expect(Math.abs(later['pricing.viewed']!.impact)).toBeLessThan(
      Math.abs(now['pricing.viewed']!.impact),
    );
  });

  it('shows what was learned: initial, learned and effective weights with hits and misses', () => {
    let s = createState(config);
    for (let i = 0; i < 10; i++) {
      const at = T + i * DAY;
      s = observe(s, { name: 'pricing.viewed', at });
      s = observe(s, { name: 'upgrade.completed', at: at + MINUTE });
      s = endEpisode(s, at + MINUTE);
      s = observe(s, { name: 'export.clicked', at: at + 2 * MINUTE });
      s = endEpisode(s, at + 3 * MINUTE);
      assertInvariants(s);
    }
    const rows = Object.fromEntries(explain(s, 'upgrade', T + 10 * DAY).map((r) => [r.signal, r]));
    expect(rows['pricing.viewed']).toMatchObject({ initialWeight: 3, hits: 10, misses: 0 });
    expect(rows['pricing.viewed']!.learnedWeight).toBeGreaterThan(3);
    expect(rows['pricing.viewed']!.effectiveWeight).toBeGreaterThan(3);
    expect(rows['export.clicked']).toMatchObject({ initialWeight: 1, hits: 0, misses: 10 });
    expect(rows['export.clicked']!.learnedWeight).toBeLessThan(0);
    expect(rows['export.clicked']!.effectiveWeight).toBeLessThan(1);
    expect(rows['limit.hit']).toMatchObject({
      initialWeight: 2,
      learnedWeight: 0,
      effectiveWeight: 2,
    });
  });

  it('returns an empty list for an intent without signals', () => {
    const s = createState({
      intents: { bare: { prior: 0.2, priorStrength: 3, halfLife: DAY, signals: {} } },
    });
    expect(explain(s, 'bare', T)).toStrictEqual([]);
  });

  it('rejects unknown intents and bad times', () => {
    const s = createState(config);
    expect(() => explain(s, 'nope', T)).toThrow(RangeError);
    expect(() => explain(s, 'upgrade', Number.NaN)).toThrow(TypeError);
  });

  describe('filters', () => {
    it('nonZero keeps only signals that currently hold evidence', () => {
      const rows = explain(withEvidence(), 'upgrade', T, { nonZero: true });
      expect(rows.map((r) => r.signal).sort()).toStrictEqual([
        'limit.hit',
        'plan.downgraded',
        'pricing.viewed',
      ]);
      expect(rows.every((r) => r.contribution !== 0)).toBe(true);
      expect(rows).toStrictEqual(
        explain(withEvidence(), 'upgrade', T).filter((r) => r.contribution !== 0),
      );
    });

    it('limit takes the top rows of the sorted list, after nonZero', () => {
      const all = explain(withEvidence(), 'upgrade', T);
      expect(explain(withEvidence(), 'upgrade', T, { limit: 2 })).toStrictEqual(all.slice(0, 2));
      expect(explain(withEvidence(), 'upgrade', T, { limit: 0 })).toStrictEqual([]);
      expect(explain(withEvidence(), 'upgrade', T, { limit: 99 })).toStrictEqual(all);
      expect(explain(withEvidence(), 'upgrade', T, { nonZero: true, limit: 1 })).toStrictEqual([
        all[0],
      ]);
    });

    it('defaults are unchanged and options are validated', () => {
      expect(explain(withEvidence(), 'upgrade', T, {})).toStrictEqual(
        explain(withEvidence(), 'upgrade', T),
      );
      expect(() => explain(withEvidence(), 'upgrade', T, { limit: -1 })).toThrow(RangeError);
      expect(() => explain(withEvidence(), 'upgrade', T, { limit: 2.5 })).toThrow(RangeError);
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      expect(() => explain(withEvidence(), 'upgrade', T, { nonZero: 1 } as any)).toThrow(TypeError);
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      expect(() => explain(withEvidence(), 'upgrade', T, { top: 2 } as any)).toThrow(TypeError);
    });
  });
});
