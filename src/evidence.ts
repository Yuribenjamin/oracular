import { normalizeIntentConfig, resolveReveal } from './config';
import { priorCounts } from './intent';
import { betaMean, betaSd, clamp01 } from './math';
import type { IntentConfig, RevealOptions } from './types';

/**
 * How much positive evidence an intent needs before {@link shouldReveal} first becomes true:
 * the smallest pseudo-count `w` such that Beta(α₀ + w, β₀) clears both `p ≥ threshold` and
 * `p − z·sd ≥ threshold`. Divide by a signal's weight and round up for the number of identical
 * signals, fired together, that open the gate. Solved numerically to 1e-9.
 *
 * Cooldowns and decay are not part of the answer: this is the evidence needed at one instant.
 *
 * @param intent - One intent's config, validated as `createState` would.
 * @param opts - `threshold` and `z` overrides, resolved as call → intent → defaults (there is
 *   no engine config here). `cooldown` is accepted and ignored.
 * @returns The pseudo-count sum; 0 when the prior alone already clears the gate; `Infinity`
 *   when no finite amount of evidence can (threshold 1).
 * @throws `TypeError` or `RangeError` when `intent` or `opts` is invalid.
 * @example
 * ```ts
 * const needed = evidenceToReveal(config.intents.upgrade); // ≈ 15.1 for the quickstart config
 * Math.ceil(needed / 3); // 6 signals of weight 3
 * ```
 */
export function evidenceToReveal(intent: IntentConfig, opts?: RevealOptions): number {
  const config = normalizeIntentConfig(intent, 'intent');
  const { threshold, z } = resolveReveal(undefined, config, opts);
  const { alpha0, beta0 } = priorCounts(config);

  const open = (w: number): boolean => {
    const alpha = alpha0 + w;
    const p = betaMean(alpha, beta0);
    return p >= threshold && clamp01(p - z * betaSd(alpha, beta0)) >= threshold;
  };

  if (threshold >= 1) return Number.POSITIVE_INFINITY;
  if (open(0)) return 0;

  // Bracket the first crossing geometrically, then bisect. Both p and the lower bound keep
  // rising with evidence past the first crossing, so the first opening is the answer.
  let lo = 0;
  let hi = 1;
  while (!open(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 1e15) return Number.POSITIVE_INFINITY;
  }
  for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    if (open(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
