/** Options that decide when `shouldReveal` fires. Resolved per call → intent → engine → defaults. */
export interface RevealOptions {
  /** Probability the intent must reach, in [0, 1]. Default 0.5. */
  threshold?: number;
  /** How many standard deviations below p must still clear the threshold. Default 1.28 (one-sided 90%). */
  z?: number;
  /** How long after `markRevealed` the intent stays revealed and `shouldReveal` is false. Default: the intent's `halfLife`. */
  cooldown?: number;
}

/** How the engine learns from the user's own outcomes. */
export interface LearningConfig {
  /** Half-life of learned hit/miss counts, in the same unit as `at`. Omit for no forgetting. */
  halfLife?: number;
  /** A perfectly predictive signal converges to `gain × |initial weight|`. Default 2. */
  gain?: number;
  /** Pseudo-count behind the developer's initial weight: how many observed episodes it takes to weigh as much as the prior. Default 10. */
  priorEpisodes?: number;
}

/** One thing the user might be about to do. */
export interface IntentConfig {
  /** Prior probability, strictly between 0 and 1. */
  prior: number;
  /** Strength of the prior as a pseudo-count, greater than 0. */
  priorStrength: number;
  /** Half-life of evidence, in the same unit as `at`. Evidence decays back toward the prior. */
  halfLife: number;
  /** Event name → initial weight. Positive is evidence for the intent, negative against. Non-zero. */
  signals: Record<string, number>;
  /** Event name that confirms the intent happened, e.g. `'checkout.completed'`. */
  outcome?: string;
  /** Reset α, β and contributions to the prior when the outcome arrives. Default true. */
  resetOnOutcome?: boolean;
  /** Reveal defaults for this intent. */
  reveal?: RevealOptions;
}

export interface EngineConfig {
  intents: Record<string, IntentConfig>;
  /** Idle gap after which the current episode ends on its own, in the same unit as `at`. Omit to end episodes only via `endEpisode`. */
  episodeTimeout?: number;
  learning?: LearningConfig;
  /** Reveal defaults for every intent. */
  reveal?: RevealOptions;
}

/** Pseudo-counts a single signal has added to an intent: `alpha` for, `beta` against. Decays with the intent. */
export interface SignalContribution {
  alpha: number;
  beta: number;
}

/** What this user's history says about one signal. Decays with `learning.halfLife`. */
export interface SignalRecord {
  /** Episodes in which the signal was followed by the outcome. */
  hits: number;
  /** Episodes in which it was not. */
  misses: number;
}

export interface IntentState {
  /** Beta α. Always equals prior α plus the sum of `contributions[*].alpha`. */
  alpha: number;
  /** Beta β. Always equals prior β plus the sum of `contributions[*].beta`. */
  beta: number;
  /** Time α, β and contributions were last decayed to. */
  updatedAt: number | null;
  contributions: Record<string, SignalContribution>;
  learned: Record<string, SignalRecord>;
  /** Episodes that ended with (`hits`) or without (`misses`) the outcome: the base rate. */
  episodes: SignalRecord;
  /** Time `learned` and `episodes` were last decayed to. */
  learnedAt: number | null;
  lastRevealedAt: number | null;
  /** Time the intent's outcome event last arrived. `shouldReveal` stays false for the cooldown after it. */
  lastOutcomeAt: number | null;
  revealCount: number;
}

export interface EpisodeIntentRecord {
  /** Signals seen since the episode started (or since this intent's last outcome). */
  seen: string[];
  /** Whether the outcome arrived in this episode. */
  resolved: boolean;
}

export interface EpisodeState {
  startedAt: number | null;
  lastEventAt: number | null;
  intents: Record<string, EpisodeIntentRecord>;
}

/** Plain JSON. Persist it with `serialize`, restore it with `deserialize`. */
export interface EngineState {
  version: typeof import('./version').STATE_VERSION;
  /** Snapshot of the config this state was built with. Pass your current config to `deserialize` on load. */
  config: EngineConfig;
  intents: Record<string, IntentState>;
  episode: EpisodeState;
}

export interface IntentEvent {
  name: string;
  /** Timestamp. Every duration in the config uses the same unit (milliseconds recommended). */
  at: number;
  /** Accepted and ignored in 0.1; never stored. */
  props?: Record<string, unknown>;
}

export interface Prediction {
  intent: string;
  /** Mean of the Beta distribution: α / (α + β). */
  p: number;
  /** Standard deviation of the Beta distribution. */
  sd: number;
  /** p − z·sd, clamped to [0, 1]. This is what `shouldReveal` compares to the threshold. */
  lower: number;
  /** 1 − 2·sd, clamped to [0, 1]. A heuristic: 1 when the estimate is sharp, 0 when it is as vague as possible. */
  confidence: number;
  /** α + β: total pseudo-observations, prior strength included. */
  evidence: number;
  /** True while inside the cooldown that follows `markRevealed`. */
  revealed: boolean;
  revealedAt: number | null;
  /**
   * When the current suppression ends: the later of the reveal cooldown (after `markRevealed`)
   * and the outcome cooldown (after the outcome event) still running at `at`, or null when
   * neither is. `shouldReveal` is false while this is non-null.
   */
  suppressedUntil: number | null;
}

export interface SignalExplanation {
  signal: string;
  /** Signed pseudo-counts this signal currently holds: positive in α, negative in β, after decay. */
  contribution: number;
  /** p minus what p would be without this signal's contribution. */
  impact: number;
  /** The developer's weight. */
  initialWeight: number;
  /** What this user's history alone says the weight should be. */
  learnedWeight: number;
  /** The blend the next occurrence of the signal will actually add. */
  effectiveWeight: number;
  hits: number;
  misses: number;
}

/** Turns a stored state of an older version into a current `EngineState`. */
export type Migrate = (stored: unknown, version: number) => EngineState;

export interface DeserializeOptions {
  /** The app's current config. Validated, swapped in, and used to prune signals and intents no longer declared. */
  config?: EngineConfig;
  /** Called when the stored version differs from `STATE_VERSION`. */
  migrate?: Migrate;
}
