// Seeds a config from a recorder log. Grouped by install, it reads what the engine itself counts
// (hits, misses and episode totals, read off the state after every record): the population's base
// rate becomes the prior, the spread of per-install base rates the prior strength, each signal's
// lift over the episodes without it its initial weight, and the half-life that predicts the log
// best under replay (lowest Brier score) wins a grid search. Because the counts come from the
// engine, tune cannot disagree with what a device would learn from the same events.
//
// Three rules keep the fit honest, each learned from a real clickstream: a signal seen in nearly
// every episode is left out (the few episodes without it are not typical sessions, so its contrast
// says little); the half-life is kept when the grid is flat (the best point gains less than 1%);
// and the report says when the fitted intent still does not beat its own base rate.
// Pure: no I/O, no clock. The CLI (run.ts) reads the files and prints what this returns.
import {
  createState,
  type EngineConfig,
  type EngineState,
  endEpisode,
  episodeClosed,
  type IntentConfig,
  type IntentState,
  type LiftType,
  markRevealed,
  observe,
  predict,
} from 'oracular';
import { laplace, learningScore, lift, smoothRate } from '../src/math';
import { groupByInstall, type LogEntry } from './log';
import { DEFAULT_THRESHOLD, replay, scoringWindow, type WindowSource } from './replay';
import { formatDuration } from './report';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Half-lives tried by default, in milliseconds; each intent's current value is added to them. */
export const DEFAULT_HALF_LIVES = [HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
/** The engine's documented default for learning.priorEpisodes; a test pins it to the engine. */
export const DEFAULT_PRIOR_EPISODES = 10;
/** Installs with at least one counted episode needed before the spread of base rates is read. */
export const MIN_INSTALLS_FOR_SPREAD = 10;
/** A prior strength read from the spread is kept inside this range. */
export const STRENGTH_RANGE: readonly [number, number] = [2, 50];
/**
 * A signal seen in more than this share of counted episodes is ubiquitous and left out of the
 * fitted config. It cannot tell episodes apart, and the few episodes without it are rarely
 * typical sessions (a checkout that opens its own session, a stub with one event), so the contrast
 * measured on them says little about the signal.
 */
export const UBIQUITY_SHARE = 0.9;
/**
 * The current half-life is kept unless the best grid point improves its Brier score by at least
 * this fraction: a flatter grid says the half-life does not matter here, not that it should change.
 */
export const FLAT_GRID_GAIN = 0.01;
/** Two-sided 90% normal quantile, for the Wilson interval on each signal's outcome rate. */
const Z90 = 1.6449;

export interface TuneOptions {
  /** Intents to fit. Default: every intent that declares an outcome. */
  intents?: string[];
  /** Half-lives to try, in the unit of `at`. Default: {@link DEFAULT_HALF_LIVES} plus each intent's current value. */
  halfLives?: number[];
  /**
   * How long after a point an outcome still counts for it when the half-life grid is scored; must
   * be positive. Default: each intent's reveal cooldown, so an intent with a cooldown of 0 needs it.
   */
  window?: number;
  /** Also count episodes in which reveals were live. Their outcomes may be caused by the reveal. */
  includeLive?: boolean;
  /** Also measure every other event name in the log as a candidate signal of each intent. */
  allEvents?: boolean;
}

export interface SignalFit {
  signal: string;
  /** The weight in the config tune started from, or null for a candidate found with `allEvents`. */
  current: number | null;
  /** Counted episodes in which the signal was seen, split by whether the outcome followed. */
  hits: number;
  misses: number;
  /** Counted episodes of the intent in which the signal was not seen, and how many ended with the outcome. */
  without: number;
  outcomesWithout: number;
  /** Outcome rates with and without the signal, shrunk toward the base rate as the engine computes them. */
  qWith: number;
  qWithout: number;
  /**
   * Raw association measure: neutral at 1 for ratios, 0 for differences/log lift. 0 if never
   * seen; null when no counted episode lacked the signal, so there is nothing to compare with.
   */
  lift: number | null;
  /** Signed evidence score in [−1, 1], neutral at 0, used by both the engine and the fitted weights; null as `lift`. */
  score: number | null;
  /**
   * priorStrength × score, rounded to two decimals; null when the signal was never seen, is
   * ubiquitous, or the weight rounds to 0. Null means the signal is left out of the fitted config.
   */
  weight: number | null;
  /** Fraction of counted episodes in which the signal was seen. */
  share: number;
  /** Seen in more than {@link UBIQUITY_SHARE} of counted episodes: left out, whatever its lift. */
  ubiquitous: boolean;
  /** The weight at the ends of a 90% Wilson interval on the outcome rate with the signal; null as `lift`. */
  low: number | null;
  high: number | null;
  /** nWith × nWithout / (nWith + nWithout): how much of both sides has been seen. */
  contrast: number;
  /** Contrast below learning.priorEpisodes: the engine itself would not yet trust this comparison. */
  thin: boolean;
}

export interface HalfLifePoint {
  halfLife: number;
  /** Brier score of the fitted config with this half-life, from replay; null when nothing could be scored. */
  brier: number | null;
  points: number;
}

export interface IntentFit {
  intent: string;
  outcome: string;
  /** Installs that contributed at least one counted episode. */
  installs: number;
  /** Counted episodes, and how many of them ended with the outcome. */
  episodes: number;
  outcomes: number;
  /** Episodes left out because a reveal was live inside them. */
  excluded: number;
  /** The fitted prior, (outcomes + 1) / (episodes + 2), and the one the config had. */
  prior: { value: number; current: number };
  priorStrength: { value: number; current: number; source: 'spread' | 'kept'; note: string };
  halfLife: {
    value: number;
    current: number;
    source: 'grid' | 'kept';
    note: string;
    /** The scoring window every grid point was replayed with. */
    window: number;
    /** Where it came from: the reveal cooldown, the half-life when the cooldown is 0, or --window. */
    windowSource: WindowSource;
    curve: HalfLifePoint[];
    /** The Brier score of always predicting the base rate, for comparison. */
    brierBaseline: number | null;
  };
  /** learning.priorEpisodes as resolved from the config: the contrast a weight needs not to be thin. */
  priorEpisodes: number;
  /**
   * Whether the fitted intent, at the chosen half-life, scores a lower Brier than always predicting
   * its base rate. False means the signals do not separate the episodes that end with the outcome
   * from the rest. Null when nothing could be scored.
   */
  beatsBaseRate: boolean | null;
  /** The intent's declared signals, in config order. */
  signals: SignalFit[];
  /** Every other event name in the log, measured the same way; only with `allEvents`. */
  candidates: SignalFit[];
}

export interface TuneReport {
  installs: number;
  records: number;
  shadow: number;
  live: number;
  mixedInstalls: number;
  start: number | null;
  end: number | null;
  scored: 'shadow' | 'all';
  intents: IntentFit[];
  skipped: { intent: string; reason: string }[];
  /** The config tune started from with every fitted value swapped in: paste it, or pass it to replay. */
  config: EngineConfig;
}

/** Pooled counts for one intent: per-signal hits and misses, and the episode totals. */
interface Tally {
  hits: Record<string, number>;
  misses: Record<string, number>;
  outcomes: number;
  episodes: number;
}

interface InstallTally {
  outcomes: number;
  episodes: number;
}

const NONE = { hits: 0, misses: 0 };

/** What one engine step added to an intent's learned counts, or null when it added nothing. */
function stepDelta(prev: IntentState, next: IntentState): Tally | null {
  const d: Tally = { hits: {}, misses: {}, outcomes: 0, episodes: 0 };
  let changed = false;
  for (const [signal, record] of Object.entries(next.learned)) {
    const before = Object.hasOwn(prev.learned, signal) ? (prev.learned[signal] ?? NONE) : NONE;
    const hits = record.hits - before.hits;
    const misses = record.misses - before.misses;
    if (hits !== 0) {
      d.hits[signal] = hits;
      changed = true;
    }
    if (misses !== 0) {
      d.misses[signal] = misses;
      changed = true;
    }
  }
  d.outcomes = next.episodes.hits - prev.episodes.hits;
  d.episodes = d.outcomes + (next.episodes.misses - prev.episodes.misses);
  if (d.episodes !== 0) changed = true;
  return changed ? d : null;
}

function addTally(into: Tally, d: Tally): void {
  for (const [signal, n] of Object.entries(d.hits)) {
    into.hits[signal] = (Object.hasOwn(into.hits, signal) ? (into.hits[signal] ?? 0) : 0) + n;
  }
  for (const [signal, n] of Object.entries(d.misses)) {
    into.misses[signal] = (Object.hasOwn(into.misses, signal) ? (into.misses[signal] ?? 0) : 0) + n;
  }
  into.outcomes += d.outcomes;
  into.episodes += d.episodes;
}

const own = (record: Record<string, number>, key: string): number =>
  Object.hasOwn(record, key) ? (record[key] ?? 0) : 0;

/** Wilson score interval for a rate, as [low, high]; [0, 1] when nothing has been observed. */
export function wilson(successes: number, n: number, z: number): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function fitSignal(
  signal: string,
  current: number | null,
  tally: Tally,
  strength: number,
  priorEpisodes: number,
  liftType: LiftType,
): SignalFit {
  const hits = own(tally.hits, signal);
  const misses = own(tally.misses, signal);
  const nWith = hits + misses;
  const without = Math.max(0, tally.episodes - nWith);
  const outcomesWithout = Math.min(without, Math.max(0, tally.outcomes - hits));
  // As the engine: both rates shrunk toward the intent's base rate by two pseudo-episodes.
  const base = tally.episodes === 0 ? 0 : tally.outcomes / tally.episodes;
  const qWith = smoothRate(hits, nWith, base);
  const qWithout = smoothRate(outcomesWithout, without, base);
  // As the engine: nothing is known about a signal until it has been seen in a completed episode.
  const baseline =
    liftType === 'association-rule'
      ? smoothRate(hits + outcomesWithout, nWith + without, base)
      : qWithout;
  // No episode without the signal: nothing to compare its rate with, so no lift and no interval
  // (the baseline would be the base rate alone, which is what the signal's own rate then is).
  const noContrast = without === 0;
  const rawLift = noContrast ? null : nWith === 0 ? 0 : lift(qWith, baseline, liftType);
  const score = rawLift === null ? null : nWith === 0 ? 0 : learningScore(rawLift, liftType);
  const contrast = nWith + without === 0 ? 0 : (nWith * without) / (nWith + without);
  const [qLow, qHigh] = wilson(hits, nWith, Z90);
  const rounded = score === null ? 0 : Math.round(strength * score * 100) / 100;
  const share = tally.episodes === 0 ? 0 : nWith / tally.episodes;
  const ubiquitous = nWith > UBIQUITY_SHARE * tally.episodes;
  return {
    signal,
    current,
    hits,
    misses,
    without,
    outcomesWithout,
    qWith,
    qWithout,
    lift: rawLift,
    score,
    weight: nWith === 0 || ubiquitous || rounded === 0 ? null : rounded,
    share,
    ubiquitous,
    low: noContrast ? null : strength * learningScore(lift(qLow, baseline, liftType), liftType),
    high: noContrast ? null : strength * learningScore(lift(qHigh, baseline, liftType), liftType),
    contrast,
    thin: contrast < priorEpisodes,
  };
}

/**
 * Prior strength from the spread of per-install base rates, by the method of moments on a Beta
 * distribution after the part of the spread that sampling alone would produce is taken out.
 */
function fitStrength(installs: InstallTally[], current: number): IntentFit['priorStrength'] {
  const k = installs.length;
  const plural = (n: number) => (n === 1 ? '' : 's');
  if (k < MIN_INSTALLS_FOR_SPREAD) {
    return {
      value: current,
      current,
      source: 'kept',
      note: `kept: ${k} install${plural(k)} with a counted episode, reading the spread needs ${MIN_INSTALLS_FOR_SPREAD}`,
    };
  }
  const total = installs.reduce((acc, i) => acc + i.episodes, 0);
  const m = installs.reduce((acc, i) => acc + i.outcomes, 0) / total;
  if (m <= 0 || m >= 1) {
    return {
      value: current,
      current,
      source: 'kept',
      note: 'kept: every counted episode ended the same way, so there is no spread to read',
    };
  }
  const observed =
    installs.reduce((acc, i) => acc + i.episodes * (i.outcomes / i.episodes - m) ** 2, 0) / total;
  const sampling = (k * m * (1 - m)) / total;
  const between = observed - sampling;
  if (between <= 0) {
    return {
      value: current,
      current,
      source: 'kept',
      note: `kept: the base rates of ${k} installs differ no more than chance would make them`,
    };
  }
  const raw = (m * (1 - m)) / between - 1;
  const [min, max] = STRENGTH_RANGE;
  const clamped = Math.min(max, Math.max(min, raw));
  const value = Math.round(clamped * 10) / 10;
  const capped = clamped !== raw ? `, capped to ${min}–${max}` : '';
  return {
    value,
    current,
    source: 'spread',
    note: `spread of base rates across ${k} installs (sd ${Math.sqrt(between).toFixed(2)} around ${m.toFixed(2)})${capped}`,
  };
}

function withIntent(config: EngineConfig, name: string, intent: IntentConfig): EngineConfig {
  return { ...config, intents: { ...config.intents, [name]: intent } };
}

/** The config with learned counts never decaying, so that the counts read off the state are whole. */
function withoutLearnedDecay(config: EngineConfig): EngineConfig {
  if (config.learning?.halfLife === undefined) return config;
  const learning = Object.fromEntries(
    Object.entries(config.learning).filter(([key]) => key !== 'halfLife'),
  );
  return { ...config, learning };
}

/**
 * The config with `attribution` off for every intent. Tune counts each episode's own verdict: the
 * window is a rule for the device's learner, and the weights tune fits are the prior that learner
 * starts from. The half-life grid keeps it on, since replay scores what the device would predict.
 */
function withoutAttribution(config: EngineConfig): EngineConfig {
  const intents = Object.fromEntries(
    Object.entries(config.intents).map(([name, intent]) => {
      if (intent.attribution === undefined) return [name, intent];
      const { attribution: _attribution, ...rest } = intent;
      return [name, rest];
    }),
  );
  return { ...config, intents };
}

/** The reveal cooldown exactly as the engine resolves it for the intent: the suppression a reveal at 0 starts. */
function cooldownOf(base: EngineState, name: string): number {
  return predict(markRevealed(base, name, 0), name, 0).suppressedUntil ?? 0;
}

/** Fits every intent that declares an outcome and returns the fit with the config to paste. */
export function tune(
  entries: readonly LogEntry[],
  config: EngineConfig,
  options: TuneOptions = {},
): TuneReport {
  const base = createState(config); // validates the config, and gives its normalized form
  const normalized = base.config;
  const includeLive = options.includeLive === true;
  const priorEpisodes = normalized.learning?.priorEpisodes ?? DEFAULT_PRIOR_EPISODES;
  const liftType = normalized.learning?.lift ?? 'normalized-difference';

  const skipped: { intent: string; reason: string }[] = [];
  const names = options.intents ?? Object.keys(normalized.intents);
  for (const name of names) {
    if (!Object.hasOwn(normalized.intents, name)) {
      throw new RangeError(
        `unknown intent ${JSON.stringify(name)} (the config declares: ${Object.keys(normalized.intents).join(', ')})`,
      );
    }
  }
  const fitting = names.filter((name) => {
    if ((normalized.intents[name] as IntentConfig).outcome !== undefined) return true;
    skipped.push({ intent: name, reason: 'declares no outcome event, so there is nothing to fit' });
    return false;
  });

  const grouped = groupByInstall(entries);

  // Scoring windows for the half-life grid, before any work: an empty window is a usage error.
  const windows = new Map<string, { window: number; windowSource: WindowSource }>();
  for (const name of fitting) {
    const intent = normalized.intents[name] as IntentConfig;
    windows.set(name, scoringWindow(options.window, cooldownOf(base, name), intent.halfLife));
  }

  // Candidates: every event name in the log that is not already a signal or the outcome of the intent.
  const eventNames = new Set<string>();
  for (const entry of entries) if (entry.kind === 'event') eventNames.add(entry.name);
  const candidatesOf = (intent: IntentConfig): string[] =>
    options.allEvents === true
      ? [...eventNames].filter(
          (name) =>
            name !== '__proto__' && name !== intent.outcome && !Object.hasOwn(intent.signals, name),
        )
      : [];

  // The engine counts for us. Learned counts must not decay, and candidates are probed as signals
  // of weight 1 (what a signal adds to p never changes what it learns).
  let countConfig = withoutAttribution(withoutLearnedDecay(normalized));
  const plans = fitting.map((name) => {
    const intent = normalized.intents[name] as IntentConfig;
    const candidates = candidatesOf(intent);
    if (candidates.length > 0) {
      countConfig = withIntent(countConfig, name, {
        ...intent,
        signals: { ...intent.signals, ...Object.fromEntries(candidates.map((c) => [c, 1])) },
      });
    }
    return {
      name,
      intent,
      candidates,
      tally: { hits: {}, misses: {}, outcomes: 0, episodes: 0 } as Tally,
      excluded: 0,
      installs: [] as InstallTally[],
    };
  });
  const countBase = createState(countConfig);

  for (const list of grouped.byInstall.values()) {
    if (!includeLive && !list.some((e) => e.mode === 'shadow')) continue;
    let state = countBase;
    /** A reveal was live somewhere in the episode that is open (or just closed). */
    let liveInSpan = false;
    const perInstall = new Map(plans.map((plan) => [plan.name, { outcomes: 0, episodes: 0 }]));
    for (const entry of list) {
      const prev = state;
      state =
        entry.kind === 'end'
          ? endEpisode(state, entry.at)
          : observe(state, { name: entry.name, at: entry.at });
      const closed = episodeClosed(prev, state);
      // An event after the idle gap closes the old episode and opens a new one with itself: what
      // the close recorded belongs to the old episode, the event itself to the new one.
      const opensNext = closed && entry.kind === 'event' && state.episode.startedAt === entry.at;
      const contaminated = liveInSpan || (!opensNext && entry.mode === 'live');
      for (const plan of plans) {
        const d = stepDelta(
          prev.intents[plan.name] as IntentState,
          state.intents[plan.name] as IntentState,
        );
        if (d === null) continue;
        if (contaminated && !includeLive) {
          plan.excluded += d.episodes;
          continue;
        }
        addTally(plan.tally, d);
        const mine = perInstall.get(plan.name) as InstallTally;
        mine.outcomes += d.outcomes;
        mine.episodes += d.episodes;
      }
      if (closed) liveInSpan = opensNext && entry.mode === 'live';
      else if (entry.mode === 'live') liveInSpan = true;
    }
    for (const plan of plans) {
      const mine = perInstall.get(plan.name) as InstallTally;
      if (mine.episodes > 0) plan.installs.push(mine);
    }
  }

  let fitted = normalized;
  const intents: IntentFit[] = [];
  for (const plan of plans) {
    const { name, intent, tally } = plan;
    if (tally.episodes === 0) {
      skipped.push({
        intent: name,
        reason:
          plan.excluded > 0
            ? 'every completed episode had a live reveal inside it, so nothing could be counted (pass --include-live to count them)'
            : 'no completed episode in the log, so nothing could be counted',
      });
      continue;
    }
    const prior = laplace(tally.outcomes, tally.episodes);
    const strength = fitStrength(plan.installs, intent.priorStrength);
    const signals = Object.keys(intent.signals).map((signal) =>
      fitSignal(
        signal,
        intent.signals[signal] as number,
        tally,
        strength.value,
        priorEpisodes,
        liftType,
      ),
    );
    const candidates = plan.candidates.map((signal) =>
      fitSignal(signal, null, tally, strength.value, priorEpisodes, liftType),
    );
    const roundedPrior = Math.round(prior * 1e4) / 1e4;
    const fittedIntent: IntentConfig = {
      ...intent,
      prior: roundedPrior > 0 && roundedPrior < 1 ? roundedPrior : prior,
      priorStrength: strength.value,
      signals: Object.fromEntries(
        signals.filter((f) => f.weight !== null).map((f) => [f.signal, f.weight as number]),
      ),
    };

    // The half-life: replay the fitted intent at every grid point and keep the best Brier score.
    const { window, windowSource } = windows.get(name) as {
      window: number;
      windowSource: WindowSource;
    };
    const threshold = intent.reveal?.threshold ?? normalized.reveal?.threshold ?? DEFAULT_THRESHOLD;
    const grid = [...new Set([...(options.halfLives ?? DEFAULT_HALF_LIVES), intent.halfLife])].sort(
      (a, b) => a - b,
    );
    let brierBaseline: number | null = null;
    const curve: HalfLifePoint[] = grid.map((halfLife) => {
      const report = replay(entries, withIntent(fitted, name, { ...fittedIntent, halfLife }), {
        intents: [name],
        thresholds: [threshold],
        window,
        includeLive,
      });
      const scored = report.intents[0];
      brierBaseline = scored?.brierBaseline ?? brierBaseline;
      return { halfLife, brier: scored?.brier ?? null, points: scored?.points ?? 0 };
    });
    const scoredPoints = curve.filter((p) => p.brier !== null);
    const atCurrent = curve.find((p) => p.halfLife === intent.halfLife) as HalfLifePoint;
    let halfLife: IntentFit['halfLife'];
    if (scoredPoints.length === 0) {
      halfLife = {
        value: intent.halfLife,
        current: intent.halfLife,
        source: 'kept',
        note: 'kept: no point in the log could be scored, so the grid says nothing',
        window,
        windowSource,
        curve,
        brierBaseline,
      };
    } else {
      const best = Math.min(...scoredPoints.map((p) => p.brier as number));
      const ties = scoredPoints.filter((p) => (p.brier as number) - best <= 1e-12);
      const nearest = (p: HalfLifePoint) => Math.abs(Math.log(p.halfLife / intent.halfLife));
      const chosen = ties.reduce((a, b) => (nearest(b) < nearest(a) ? b : a));
      const baseline =
        brierBaseline === null
          ? ''
          : ` (always predicting the base rate: ${(brierBaseline as number).toFixed(4)})`;
      // A flat grid says the half-life hardly matters here; the current value is as good a choice
      // as any, and swapping it for a point that gains a fraction of a percent would mislead.
      const gain =
        atCurrent.brier === null || atCurrent.brier <= 0
          ? Number.POSITIVE_INFINITY
          : (atCurrent.brier - best) / atCurrent.brier;
      if (chosen.halfLife !== intent.halfLife && gain < FLAT_GRID_GAIN) {
        halfLife = {
          value: intent.halfLife,
          current: intent.halfLife,
          source: 'kept',
          note: `kept: the grid is flat, the best point (${formatDuration(chosen.halfLife)}, ${best.toFixed(4)}) improves on the current value (${(atCurrent.brier as number).toFixed(4)}) by ${(gain * 100).toFixed(2)}%, less than ${FLAT_GRID_GAIN * 100}%${baseline}`,
          window,
          windowSource,
          curve,
          brierBaseline,
        };
      } else {
        halfLife = {
          value: chosen.halfLife,
          current: intent.halfLife,
          source: 'grid',
          note: `lowest Brier score over the grid, ${best.toFixed(4)}${baseline}`,
          window,
          windowSource,
          curve,
          brierBaseline,
        };
      }
    }
    fitted = withIntent(fitted, name, { ...fittedIntent, halfLife: halfLife.value });
    const scoredAt = curve.find((p) => p.halfLife === halfLife.value) as HalfLifePoint;
    const beatsBaseRate =
      scoredAt.brier === null || brierBaseline === null
        ? null
        : scoredAt.brier < (brierBaseline as number);

    intents.push({
      intent: name,
      outcome: intent.outcome as string,
      installs: plan.installs.length,
      episodes: tally.episodes,
      outcomes: tally.outcomes,
      excluded: plan.excluded,
      prior: { value: prior, current: intent.prior },
      priorStrength: strength,
      halfLife,
      priorEpisodes,
      beatsBaseRate,
      signals,
      candidates,
    });
  }

  return {
    installs: grouped.byInstall.size,
    records: entries.length,
    shadow: grouped.shadow,
    live: grouped.live,
    mixedInstalls: grouped.mixedInstalls,
    start: grouped.start,
    end: grouped.end,
    scored: includeLive ? 'all' : 'shadow',
    intents,
    skipped,
    config: createState(fitted).config, // normalized once more: it must be a config the engine takes
  };
}
