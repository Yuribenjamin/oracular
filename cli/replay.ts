// Replays a recorder log through the engine under a given config and measures the result.
// Pure: no I/O, no clock. The CLI (run.ts) reads the files and prints what this returns.
import {
  createState,
  type EngineConfig,
  type EngineState,
  endEpisode,
  type IntentConfig,
  markRevealed,
  observe,
  predict,
  shouldReveal,
} from 'oracular';
import { groupByInstall, type LogEntry } from './log';

export type { LogEntry, Mode } from './log';

export interface ReplayOptions {
  /** Thresholds to score. Default: 0.3 to 0.9 by 0.1, plus each intent's configured threshold. */
  thresholds?: number[];
  /**
   * How long after a reveal an outcome still counts for it; must be positive. Default: each
   * intent's reveal cooldown, so an intent with a cooldown of 0 needs an explicit window.
   */
  window?: number;
  /** Intents to score. Default: every intent that declares an outcome. */
  intents?: string[];
  /** Score live periods too. Their precision is contaminated: the reveal itself causes outcomes. */
  includeLive?: boolean;
  /** Reliability bins over [0, 1]. Default 10. */
  bins?: number;
}

export interface ThresholdResult {
  threshold: number;
  /** Whether this is the threshold the config resolves for the intent. */
  configured: boolean;
  reveals: number;
  /** Reveals followed by the outcome within the window. */
  correct: number;
  precision: number | null;
  outcomes: number;
  /** Outcomes preceded by a reveal within the window. */
  caught: number;
  recall: number | null;
  /** Median time from a correct reveal to the first outcome after it. */
  leadTime: number | null;
  revealsPerUser: number | null;
  /** Reveals whose window runs past the end of the log: not scored. */
  censored: number;
}

export interface ReliabilityBin {
  from: number;
  to: number;
  count: number;
  meanP: number;
  /** Fraction of these points followed by the outcome within the window. */
  observed: number;
}

export interface IntentReport {
  intent: string;
  outcome: string;
  window: number;
  /** Where the window came from. */
  windowSource: WindowSource;
  /** @deprecated `windowSource === 'cooldown'`; superseded in 0.10, kept for readers of earlier reports and never removed. */
  windowIsCooldown: boolean;
  installs: number;
  thresholds: ThresholdResult[];
  /** Points scored for reliability: p after every event except the intent's own outcome. */
  points: number;
  /** Points whose window runs past the end of the log: not scored. */
  censored: number;
  reliability: ReliabilityBin[];
  brier: number | null;
  /** Fraction of scored points followed by the outcome. */
  baseRate: number | null;
  /** The Brier score of always predicting the base rate, for comparison. */
  brierBaseline: number | null;
}

export interface ReplayReport {
  installs: number;
  records: number;
  shadow: number;
  live: number;
  /** Installs whose records include both modes. */
  mixedInstalls: number;
  start: number | null;
  end: number | null;
  scored: 'shadow' | 'all';
  intents: IntentReport[];
  skipped: { intent: string; reason: string }[];
}

export const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
/** The engine's documented default for reveal.threshold; a test pins it to the engine. */
export const DEFAULT_THRESHOLD = 0.5;

/** Where an intent's scoring window comes from: `--window`, its reveal cooldown, or its half-life when the cooldown is 0. */
export type WindowSource = 'option' | 'cooldown' | 'halfLife';

/**
 * The window outcomes must follow a reveal within: as given, else the intent's reveal cooldown,
 * else (a cooldown of 0) its half-life. With an empty window no outcome could ever follow a
 * reveal: every reveal would score as wrong and every point as a non-outcome, silently.
 */
export function scoringWindow(
  given: number | undefined,
  cooldown: number,
  halfLife: number,
): { window: number; windowSource: WindowSource } {
  if (given !== undefined) {
    if (!(given > 0)) throw new RangeError('the scoring window must be greater than 0');
    return { window: given, windowSource: 'option' };
  }
  if (cooldown > 0) return { window: cooldown, windowSource: 'cooldown' };
  return { window: halfLife, windowSource: 'halfLife' };
}

/** Runs every install's records through the engine and measures each intent at each threshold. */
export function replay(
  entries: readonly LogEntry[],
  config: EngineConfig,
  options: ReplayOptions = {},
): ReplayReport {
  const base = createState(config); // validates the config, and gives its normalized form
  const normalized = base.config;
  const includeLive = options.includeLive === true;
  const bins = options.bins ?? 10;

  const skipped: { intent: string; reason: string }[] = [];
  const names = options.intents ?? Object.keys(normalized.intents);
  for (const name of names) {
    if (!Object.hasOwn(normalized.intents, name)) {
      throw new RangeError(
        `unknown intent ${JSON.stringify(name)} (the config declares: ${Object.keys(normalized.intents).join(', ')})`,
      );
    }
  }
  const scored = names.filter((name) => {
    if ((normalized.intents[name] as IntentConfig).outcome !== undefined) return true;
    skipped.push({
      intent: name,
      reason: 'declares no outcome event, so there is nothing to score',
    });
    return false;
  });

  // Per intent: the thresholds to score and the scoring window.
  const plans = scored.map((name) => {
    const intent = normalized.intents[name] as IntentConfig;
    const configured =
      intent.reveal?.threshold ?? normalized.reveal?.threshold ?? DEFAULT_THRESHOLD;
    const list = options.thresholds ?? [...DEFAULT_THRESHOLDS, configured];
    const thresholds = [...new Set(list)].sort((a, b) => a - b);
    // The cooldown exactly as the engine resolves it: the suppression a reveal at 0 starts.
    const cooldown = predict(markRevealed(base, name, 0), name, 0).suppressedUntil ?? 0;
    // Without a cooldown there is no window to inherit: the intent's half-life stands in, the
    // horizon its evidence is sized for.
    const { window, windowSource } = scoringWindow(options.window, cooldown, intent.halfLife);
    return {
      name,
      outcome: intent.outcome as string,
      configured,
      thresholds,
      window,
      windowSource,
      windowIsCooldown: windowSource === 'cooldown',
    };
  });
  const allThresholds = [...new Set(plans.flatMap((p) => p.thresholds))].sort((a, b) => a - b);

  const { byInstall, start, end, shadow, live, mixedInstalls } = groupByInstall(entries);
  const logEnd = end ?? 0;

  /** Running totals for one threshold of one intent, across installs. */
  type Totals = {
    threshold: number;
    reveals: number;
    correct: number;
    outcomes: number;
    caught: number;
    leads: number[];
    censored: number;
  };
  const tallies = plans.map((plan) => ({
    plan,
    installs: 0,
    totals: plan.thresholds.map(
      (threshold): Totals => ({
        threshold,
        reveals: 0,
        correct: 0,
        outcomes: 0,
        caught: 0,
        leads: [],
        censored: 0,
      }),
    ),
    points: [] as { p: number; y: number }[],
    censored: 0,
  }));

  for (const list of byInstall.values()) {
    if (!includeLive && !list.some((e) => e.mode === 'shadow')) continue;
    const liveTimes = list.filter((e) => e.mode === 'live').map((e) => e.at);
    /** No live record of this install in [from, to]: the span measures nothing but the engine. */
    const shadowSpan = (from: number, to: number) =>
      includeLive || !liveTimes.some((t) => t >= from && t <= to);

    // One engine state per threshold: evidence is identical, reveal cooldowns are not.
    const states = new Map<number, EngineState>(allThresholds.map((t) => [t, base]));
    const tracks = tallies.map((tally) => ({
      tally,
      outcomes: [] as number[],
      points: [] as { at: number; p: number }[],
      reveals: tally.plan.thresholds.map((threshold) => ({ threshold, times: [] as number[] })),
    }));

    for (const entry of list) {
      for (const [t, s] of states) {
        states.set(
          t,
          entry.kind === 'end'
            ? endEpisode(s, entry.at)
            : observe(s, { name: entry.name, at: entry.at }),
        );
      }
      if (entry.kind === 'end') continue;
      for (const track of tracks) {
        const { plan } = track.tally;
        if (entry.name === plan.outcome) {
          track.outcomes.push(entry.at);
        } else {
          const any = states.get(allThresholds[0] as number) as EngineState;
          track.points.push({ at: entry.at, p: predict(any, plan.name, entry.at).p });
        }
        for (const slot of track.reveals) {
          const s = states.get(slot.threshold) as EngineState;
          if (shouldReveal(s, plan.name, entry.at, { threshold: slot.threshold })) {
            slot.times.push(entry.at);
            states.set(slot.threshold, markRevealed(s, plan.name, entry.at));
          }
        }
      }
    }

    for (const { tally, outcomes, points, reveals } of tracks) {
      const { window } = tally.plan;
      tally.installs++;
      const firstOutcomeAfter = (t: number) => outcomes.find((o) => o > t && o <= t + window);
      for (const point of points) {
        if (!shadowSpan(point.at, point.at + window)) continue;
        if (point.at + window > logEnd) {
          tally.censored++;
          continue;
        }
        tally.points.push({ p: point.p, y: firstOutcomeAfter(point.at) === undefined ? 0 : 1 });
      }
      for (const [k, slot] of reveals.entries()) {
        const sum = tally.totals[k] as Totals;
        for (const r of slot.times) {
          if (!shadowSpan(r, r + window)) continue;
          if (r + window > logEnd) {
            sum.censored++;
            continue;
          }
          sum.reveals++;
          const o = firstOutcomeAfter(r);
          if (o !== undefined) {
            sum.correct++;
            sum.leads.push(o - r);
          }
        }
        for (const o of outcomes) {
          if (!shadowSpan(o - window, o)) continue;
          sum.outcomes++;
          if (slot.times.some((r) => r >= o - window && r < o)) sum.caught++;
        }
      }
    }
  }

  const intents: IntentReport[] = tallies.map(({ plan, installs, totals, points, censored }) => {
    const n = points.length;
    const hits = points.reduce((acc, pt) => acc + pt.y, 0);
    const baseRate = n === 0 ? null : hits / n;
    const reliability: ReliabilityBin[] = [];
    for (let b = 0; b < bins; b++) {
      const inBin = points.filter((pt) => Math.min(Math.floor(pt.p * bins), bins - 1) === b);
      if (inBin.length === 0) continue;
      reliability.push({
        from: b / bins,
        to: (b + 1) / bins,
        count: inBin.length,
        meanP: inBin.reduce((acc, pt) => acc + pt.p, 0) / inBin.length,
        observed: inBin.reduce((acc, pt) => acc + pt.y, 0) / inBin.length,
      });
    }
    return {
      intent: plan.name,
      outcome: plan.outcome,
      window: plan.window,
      windowSource: plan.windowSource,
      windowIsCooldown: plan.windowIsCooldown,
      installs,
      thresholds: totals.map((s) => {
        return {
          threshold: s.threshold,
          configured: s.threshold === plan.configured,
          reveals: s.reveals,
          correct: s.correct,
          precision: s.reveals === 0 ? null : s.correct / s.reveals,
          outcomes: s.outcomes,
          caught: s.caught,
          recall: s.outcomes === 0 ? null : s.caught / s.outcomes,
          leadTime: median(s.leads),
          revealsPerUser: installs === 0 ? null : s.reveals / installs,
          censored: s.censored,
        };
      }),
      points: n,
      censored,
      reliability,
      brier: n === 0 ? null : points.reduce((acc, pt) => acc + (pt.p - pt.y) ** 2, 0) / n,
      baseRate,
      brierBaseline: baseRate === null ? null : baseRate * (1 - baseRate),
    };
  });

  return {
    installs: byInstall.size,
    records: entries.length,
    shadow,
    live,
    mixedInstalls,
    start,
    end,
    scored: includeLive ? 'all' : 'shadow',
    intents,
    skipped,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const at = (i: number) => sorted[i] as number;
  return sorted.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}
