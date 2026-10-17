import { expectName, expectTimestamp, resolveReveal } from './config';
import { decayIntent } from './intent';
import { betaMean, betaSd, clamp01 } from './math';
import { getIntentState, requireIntentConfig, requireState } from './state';
import type { EngineState, Prediction, RevealOptions } from './types';

/** The intent's current estimate at time `at`. Read-only: the stored state is not decayed in place. */
export function predict(
  state: EngineState,
  intent: string,
  at: number,
  opts?: RevealOptions,
): Prediction {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const reveal = resolveReveal(s.config, config, opts);
  const is = decayIntent(getIntentState(s, name, config), config, t);

  const p = betaMean(is.alpha, is.beta);
  const sd = betaSd(is.alpha, is.beta);
  const revealed = is.lastRevealedAt !== null && t - is.lastRevealedAt < reveal.cooldown;

  return {
    intent: name,
    p,
    sd,
    lower: clamp01(p - reveal.z * sd),
    confidence: clamp01(1 - 2 * sd),
    evidence: is.alpha + is.beta,
    revealed,
    revealedAt: is.lastRevealedAt,
  };
}

/**
 * True when the intent is at least `threshold` likely, the lower confidence bound p − z·sd
 * also clears the threshold, and the intent is not inside a reveal cooldown.
 */
export function shouldReveal(
  state: EngineState,
  intent: string,
  at: number,
  opts?: RevealOptions,
): boolean {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const config = requireIntentConfig(s, name);
  const { threshold } = resolveReveal(s.config, config, opts);
  const prediction = predict(s, name, at, opts);
  return !prediction.revealed && prediction.p >= threshold && prediction.lower >= threshold;
}

/** Records that the app acted on the intent at `at`, starting its cooldown. Evidence is untouched. */
export function markRevealed(state: EngineState, intent: string, at: number): EngineState {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const is = getIntentState(s, name, config);
  return {
    ...s,
    intents: {
      ...s.intents,
      [name]: { ...is, lastRevealedAt: t, revealCount: is.revealCount + 1 },
    },
  };
}
