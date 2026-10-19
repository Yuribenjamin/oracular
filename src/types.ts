import type { RECORD_VERSION, STATE_VERSION } from './version';

/**
 * Options that decide when `shouldReveal` fires and how long cooldowns last. Resolved per call →
 * intent → engine → defaults.
 *
 * @example
 * ```ts
 * shouldReveal(state, 'upgrade', Date.now(), { threshold: 0.7, z: 1.64 });
 * ```
 */
export interface RevealOptions {
  /** Probability the intent must reach, in [0, 1]. Default 0.5. */
  threshold?: number;
  /** How many standard deviations below p must still clear the threshold. Default 1.28 (one-sided 90%). */
  z?: number;
  /** How long after `markRevealed` the intent stays revealed and `shouldReveal` is false. Default: the intent's `halfLife`. */
  cooldown?: number;
}

/**
 * How the engine learns from the user's own outcomes.
 *
 * @example
 * ```ts
 * const config = {
 *   intents,
 *   learning: { priorEpisodes: 5, gain: 1.5, halfLife: 90 * 24 * 60 * 60 * 1000 },
 * };
 * ```
 */
export interface LearningConfig {
  /** Half-life of learned hit/miss counts, in the same unit as `at`. Omit for no forgetting. */
  halfLife?: number;
  /** A perfectly predictive signal converges to `gain × |initial weight|`. Default 2; at most 1e6. */
  gain?: number;
  /** Pseudo-count behind the developer's initial weight: how many observed episodes it takes to weigh as much as the prior. Default 10; at most 1e6. */
  priorEpisodes?: number;
}

/**
 * One thing the user might be about to do, tracked as a Beta(α, β) distribution with
 * α₀ = prior × priorStrength and β₀ = (1 − prior) × priorStrength.
 *
 * @example
 * ```ts
 * const churn: IntentConfig = {
 *   prior: 0.08,
 *   priorStrength: 20,
 *   halfLife: 14 * 24 * 60 * 60 * 1000,
 *   signals: { 'session.short': 1, 'notifications.disabled': 3, 'feature.new.used': -2 },
 *   outcome: 'account.cancelled',
 *   reveal: { threshold: 0.5, z: 1.64 },
 * };
 * ```
 */
export interface IntentConfig {
  /** Prior probability, strictly between 0 and 1. */
  prior: number;
  /** Strength of the prior as a pseudo-count, greater than 0 and at most 1e6. */
  priorStrength: number;
  /** Half-life of evidence, in the same unit as `at`. Evidence decays back toward the prior. */
  halfLife: number;
  /** Event name → initial weight. Positive is evidence for the intent, negative against. Non-zero, between −1e6 and 1e6. */
  signals: Record<string, number>;
  /** Event name that confirms the intent happened, e.g. `'checkout.completed'`. */
  outcome?: string;
  /** Reset α, β and contributions to the prior when the outcome arrives. Default true. */
  resetOnOutcome?: boolean;
  /**
   * Repeats of a signal within one episode add less: the n-th occurrence adds
   * `w × log2(1 + 1/n)`, so ten occurrences add 3.46 weights, not ten. The count restarts when
   * the episode ends or this intent's outcome arrives. Default: true when `episodeTimeout` is
   * set, false otherwise, because without an idle timeout episodes end only when the app calls
   * `endEpisode`, and if it never does the count would never restart. Set true to saturate
   * anyway (your app ends every episode itself), or false for intents where the repetition
   * itself is the evidence (a user stuck on the same step), so every occurrence adds its full
   * weight.
   */
  saturate?: boolean;
  /**
   * How long a closed episode's signals wait for the outcome before they take a miss, in the same
   * unit as `at`. With it set, an episode that ends without the outcome is held instead of
   * counted. When the outcome arrives inside the window, each held episode gets a share
   * `2^(−age / halfLife)` of a hit and the rest of a miss, with `age` measured from the episode's
   * close: the sessions that built up to the outcome are credited by how much of their evidence
   * still stands. When the window passes, the episode is a miss, recorded at the moment the window
   * ended. Unset: an episode that ends without the outcome is a miss at once. A natural first value
   * is the intent's `halfLife`, where the smallest share inside the window is one half.
   */
  attribution?: number;
  /** Reveal defaults for this intent. */
  reveal?: RevealOptions;
}

/**
 * Everything `createState` needs. A normalized copy is stored in the state; pass the current
 * config to `deserialize` on load.
 *
 * @example
 * ```ts
 * const config: EngineConfig = {
 *   episodeTimeout: 30 * 60 * 1000,
 *   intents: { upgrade, churn },
 *   reveal: { z: 1.28 },
 * };
 * ```
 */
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
  /** Episodes in which the signal was followed by the outcome. An episode credited by a later outcome under `attribution` adds its share here and the rest to `misses`. */
  hits: number;
  /** Episodes in which it was not. */
  misses: number;
}

/** A closed episode waiting for the intent's outcome inside its `attribution` window. */
export interface PendingEpisode {
  /** When the episode closed. Its wait ends `attribution` later. */
  endedAt: number;
  /** The signals seen in it, each once. */
  seen: string[];
}

/**
 * Everything the engine knows about one intent for this user. Plain data; read it for debugging
 * or dashboards, but change it only through the engine's functions.
 */
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
  /**
   * Closed episodes whose verdict waits for the outcome (see {@link IntentConfig.attribution}),
   * in order of close, at most 32. Empty unless `attribution` is set.
   */
  pending: PendingEpisode[];
  /** Time `learned` and `episodes` were last decayed to. */
  learnedAt: number | null;
  lastRevealedAt: number | null;
  /** Time the intent's outcome event last arrived. `shouldReveal` stays false for the cooldown after it. */
  lastOutcomeAt: number | null;
  revealCount: number;
}

/** What one intent has seen in the current episode. */
export interface EpisodeIntentRecord {
  /** Signals seen since the episode started (or since this intent's last outcome). */
  seen: string[];
  /**
   * How many times each signal in `seen` has occurred over the same span; its keys are exactly the
   * signals in `seen`. Repeats saturate: the n-th occurrence adds less than the first.
   */
  counts: Record<string, number>;
  /** Whether the outcome arrived in this episode. */
  resolved: boolean;
}

/** The current episode (session). One episode is open at a time, shared by all intents. */
export interface EpisodeState {
  startedAt: number | null;
  lastEventAt: number | null;
  intents: Record<string, EpisodeIntentRecord>;
}

/**
 * The whole engine state: plain JSON with no functions, class instances or hidden fields.
 * Persist it with `serialize`, restore it with `deserialize`.
 *
 * @example
 * ```ts
 * const state = createState(config);
 * state.intents.upgrade.alpha; // 0.5 for prior 0.05 × priorStrength 10
 * JSON.stringify(state) === serialize(state); // true
 * ```
 */
export interface EngineState {
  version: typeof STATE_VERSION;
  /** Snapshot of the config this state was built with. Pass your current config to `deserialize` on load. */
  config: EngineConfig;
  intents: Record<string, IntentState>;
  episode: EpisodeState;
}

/**
 * What the app feeds to `observe`. Any event name is accepted; only names that appear in some
 * intent's `signals` or as its `outcome` change evidence, every event extends the episode.
 *
 * @example
 * ```ts
 * observe(state, { name: 'pricing.viewed', at: Date.now(), props: { plan: 'pro' } });
 * ```
 */
export interface IntentEvent {
  name: string;
  /** Timestamp. Every duration in the config uses the same unit (milliseconds recommended). */
  at: number;
  /** Accepted and ignored in 0.1; never stored. */
  props?: Record<string, unknown>;
}

/**
 * What `predict` returns for one intent at one moment.
 *
 * @example
 * ```ts
 * const { p, lower, confidence, revealed, suppressedUntil } = predict(state, 'upgrade', now);
 * ```
 */
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

/**
 * One row of `explain`: what a single signal is doing to an intent right now, and what has been
 * learned about it.
 *
 * @example
 * ```ts
 * const [strongest] = explain(state, 'upgrade', now);
 * strongest?.signal; // the signal with the largest |impact|
 * ```
 */
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
  /**
   * The blend of initial and learned weight: what the signal adds the first time it occurs in an
   * episode. Repeats within the episode add less (see {@link IntentConfig.saturate}).
   */
  effectiveWeight: number;
  hits: number;
  misses: number;
}

/**
 * Filters for `explain` and `evaluate`. By default every declared signal is returned.
 *
 * @example
 * ```ts
 * explain(state, 'upgrade', now, { nonZero: true, limit: 3 }); // the three signals doing the most
 * ```
 */
export interface ExplainOptions {
  /** Only signals that currently hold evidence (a non-zero contribution). Default false. */
  nonZero?: boolean;
  /** At most this many rows, taken from the top of the impact-sorted list. Default: all. */
  limit?: number;
}

/** Reveal overrides and explain filters together, for `evaluate`. */
export interface EvaluateOptions extends RevealOptions, ExplainOptions {}

/**
 * What `evaluate` returns: the same values `predict`, `shouldReveal` and `explain` would give
 * for the same inputs, computed from a single decay pass.
 *
 * @example
 * ```ts
 * const { prediction, reveal, explanation } = evaluate(state, 'upgrade', Date.now());
 * ```
 */
export interface Evaluation {
  prediction: Prediction;
  reveal: boolean;
  explanation: SignalExplanation[];
}

/**
 * Turns a stored state of a version this library cannot migrate itself into a current
 * `EngineState`. Receives the parsed JSON as-is and the version it declares. States saved by
 * oracular 0.1.0 to 0.5.x (versions 1 and 2) never reach it, nor does a state one version newer
 * than `STATE_VERSION`: `deserialize` handles both on its own.
 *
 * @example
 * ```ts
 * const migrate: Migrate = (stored, version) => {
 *   if (version === 0) return { ...(stored as object), version: 1 } as EngineState;
 *   throw new Error(`unknown state version ${version}`);
 * };
 * ```
 */
export type Migrate = (stored: unknown, version: number) => EngineState;

/**
 * Options for `deserialize`.
 *
 * @example
 * ```ts
 * deserialize(saved, { config: currentConfig, migrate });
 * ```
 */
export interface DeserializeOptions {
  /** The app's current config. Validated, swapped in, and used to prune signals and intents no longer declared. */
  config?: EngineConfig;
  /**
   * Called when the stored version is neither `STATE_VERSION`, nor one this library migrates
   * itself (states from oracular 0.1.0 to 0.5.x are upgraded without it), nor the next version,
   * which it reads as its own.
   */
  migrate?: Migrate;
}

/**
 * Whether the app acted on reveals when a record was made: `'shadow'` when it only computed them
 * (nothing shown to the user), `'live'` when it showed them. Replay only measures shadow periods
 * honestly: once a reveal is live, the reveal itself causes outcomes.
 */
export type RecordMode = 'shadow' | 'live';

/**
 * What every record needs from the app, for {@link createRecord} and {@link createEndRecord}.
 *
 * @example
 * ```ts
 * const recording: RecordOptions = { installId: storedInstallId, mode: 'shadow' };
 * ```
 */
export interface RecordOptions {
  /**
   * A random id the app generates once, on first use, and stores (for example
   * `crypto.randomUUID()`). It groups one install's records across exports and nothing else; never
   * derive it from the device, the account or anything else about the user.
   */
  installId: string;
  /** Whether reveals are shown to the user right now. */
  mode: RecordMode;
  /** How many signals to list in `top`, by size of impact. Default 3. */
  top?: number;
}

/**
 * What the engine decided for one intent at the moment of a record. It is there to compare what
 * shipped with what a different config would have done; replay recomputes everything from the
 * events and never reads it.
 */
export interface RecordedDecision {
  /** As {@link Prediction.p}. */
  p: number;
  /** As {@link Prediction.lower}. */
  lower: number;
  /** What `shouldReveal` returned with the state's own reveal options. */
  shouldReveal: boolean;
  /** As {@link Prediction.suppressedUntil}. */
  suppressedUntil: number | null;
  /** Signals currently holding evidence, largest |impact| first, at most `RecordOptions.top`. */
  top: { signal: string; impact: number }[];
  /** Effective weight of every declared signal, in config order. */
  weights: Record<string, number>;
}

/**
 * One line of a recorder log: an event the app observed and what the engine decided right after
 * it. The event (`name` and `at`, never `props`) is what replay recomputes from; the decisions
 * are kept apart so they can never be mistaken for inputs.
 *
 * @example
 * ```ts
 * state = observe(state, event);
 * log.append(JSON.stringify(createRecord(state, event, recording)));
 * ```
 */
export interface EventRecord {
  v: typeof RECORD_VERSION;
  kind: 'event';
  installId: string;
  mode: RecordMode;
  event: { name: string; at: number };
  /** One entry per declared intent. */
  decisions: Record<string, RecordedDecision>;
}

/**
 * One line of a recorder log: the app ended the episode with {@link endEpisode}. Replay needs it
 * to reproduce the misses that the episode's end records; episodes that end through
 * `episodeTimeout` need no record.
 *
 * @example
 * ```ts
 * state = endEpisode(state, at);
 * log.append(JSON.stringify(createEndRecord(at, recording)));
 * ```
 */
export interface EndRecord {
  v: typeof RECORD_VERSION;
  kind: 'end';
  installId: string;
  mode: RecordMode;
  at: number;
}

/** A line of a recorder log. */
export type RecorderRecord = EventRecord | EndRecord;

/**
 * The intents `oracular/presets` ships. Each is a plain {@link IntentConfig} to spread into your
 * config and override; `presetSources` there says where its numbers come from.
 */
export type PresetName = 'willBuy' | 'upgrade' | 'stuck' | 'churn';

/**
 * Where a preset's numbers come from, as `presetSources` in `oracular/presets` reports it. A tuned
 * preset was fitted by `oracular tune` on a real log and carries the sample behind it; a
 * hand-written one is a careful guess nobody has measured. Either is a starting point: run in
 * shadow mode and let `tune` replace it with your own numbers.
 *
 * @example
 * ```ts
 * import { presetSources } from 'oracular/presets';
 * presetSources.willBuy.kind; // 'tuned'
 * ```
 */
export interface PresetSource {
  kind: 'tuned' | 'hand-written';
  /** What the numbers were fitted on, or where the guess comes from. */
  note: string;
  /** Counted episodes behind a tuned preset; null for a hand-written one. */
  episodes: number | null;
  /** Installs those episodes came from; null for a hand-written one. */
  installs: number | null;
}
