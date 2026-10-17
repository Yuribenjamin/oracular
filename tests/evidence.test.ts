import {
  createState,
  type EngineConfig,
  evidenceToReveal,
  type IntentConfig,
  observe,
  shouldReveal,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { DAY, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;
const upgrade = upgradeConfig().intents.upgrade!;

/** Identical signals of weight `w`, fired together, until the gate opens. */
function signalsUntilReveal(
  intent: IntentConfig,
  w: number,
  opts?: Parameters<typeof shouldReveal>[3],
): number {
  const config: EngineConfig = {
    intents: { x: { ...intent, signals: { s: w }, reveal: intent.reveal ?? {} } },
  };
  let s = createState(config);
  for (let i = 1; i <= 2000; i++) {
    s = observe(s, { name: 's', at: T });
    if (shouldReveal(s, 'x', T, opts)) return i;
  }
  return Number.POSITIVE_INFINITY;
}

const count = (needed: number, w: number) => Math.ceil(needed / w - 1e-9);

describe('evidenceToReveal', () => {
  it('matches the quickstart tables: 6 signals of weight 3, 8 of weight 2, 16 of weight 1', () => {
    const needed = evidenceToReveal(upgrade);
    expect(needed).toBeGreaterThan(15);
    expect(needed).toBeLessThanOrEqual(16);
    expect(count(needed, 3)).toBe(6);
    expect(count(needed, 2)).toBe(8);
    expect(count(needed, 1)).toBe(16);
  });

  it('agrees with brute force across priors, strengths, thresholds and z', () => {
    for (const prior of [0.02, 0.05, 0.1, 0.3])
      for (const priorStrength of [2, 5, 10, 20, 50])
        for (const [threshold, z] of [
          [0.3, 1.28],
          [0.5, 0],
          [0.5, 1.28],
          [0.5, 2],
          [0.7, 1.28],
          [0.9, 1.64],
        ] as const)
          for (const w of [1, 2, 3, 5]) {
            const intent: IntentConfig = { prior, priorStrength, halfLife: DAY, signals: { s: w } };
            const needed = evidenceToReveal(intent, { threshold, z });
            const label = `prior ${prior} strength ${priorStrength} θ ${threshold} z ${z} w ${w}`;
            expect(count(needed, w), label).toBe(signalsUntilReveal(intent, w, { threshold, z }));
          }
  });

  it('is exact where the answer is analytic: z = 0 needs α = β at threshold 0.5', () => {
    // α0 + w = β0  →  w = (1 − 2·prior) · priorStrength = 0.9 × 10 = 9
    expect(evidenceToReveal(upgrade, { z: 0 })).toBeCloseTo(9, 6);
  });

  it('is 0 when the prior already clears the gate and Infinity when nothing can', () => {
    expect(evidenceToReveal({ ...upgrade, prior: 0.95, priorStrength: 200 })).toBe(0);
    expect(evidenceToReveal(upgrade, { threshold: 0 })).toBe(0);
    expect(evidenceToReveal(upgrade, { threshold: 1 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('grows with priorStrength, threshold and z', () => {
    const e = (patch: Partial<IntentConfig>, opts?: { threshold?: number; z?: number }) =>
      evidenceToReveal({ ...upgrade, ...patch }, opts);
    expect(e({ priorStrength: 5 })).toBeLessThan(e({ priorStrength: 10 }));
    expect(e({ priorStrength: 10 })).toBeLessThan(e({ priorStrength: 20 }));
    expect(e({}, { threshold: 0.5 })).toBeLessThan(e({}, { threshold: 0.7 }));
    expect(e({}, { z: 1.28 })).toBeLessThan(e({}, { z: 2 }));
  });

  it('resolves options as call → intent → defaults, ignoring cooldown', () => {
    const strict: IntentConfig = { ...upgrade, reveal: { threshold: 0.8 } };
    expect(evidenceToReveal(strict)).toBeCloseTo(evidenceToReveal(upgrade, { threshold: 0.8 }), 9);
    expect(evidenceToReveal(strict, { threshold: 0.5 })).toBeCloseTo(evidenceToReveal(upgrade), 9);
    expect(evidenceToReveal(upgrade, { cooldown: 5 })).toBeCloseTo(evidenceToReveal(upgrade), 9);
  });

  it('validates like createState', () => {
    expect(() => evidenceToReveal({ ...upgrade, prior: 1 })).toThrow(RangeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => evidenceToReveal({ ...upgrade, halflife: 1 } as any)).toThrow(TypeError);
    expect(() => evidenceToReveal(upgrade, { threshold: 2 })).toThrow(RangeError);
  });
});
