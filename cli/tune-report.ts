// Turns a tune report into the text a person reads in a terminal, or into JSON.
import { formatDuration, formatTime, num, table } from './report';
import type { IntentFit, SignalFit, TuneReport } from './tune';

const signed = (x: number, digits: number) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function note(fit: SignalFit, priorEpisodes: number): string {
  if (fit.hits + fit.misses === 0) return 'never seen in a counted episode';
  const notes: string[] = [];
  if (fit.ubiquitous) {
    notes.push(
      `in ${(fit.share * 100).toFixed(1)}% of episodes, so it cannot tell them apart; left out of the config`,
    );
  } else if (fit.weight === null) {
    notes.push('no measurable lift, left out of the config');
  }
  if (fit.thin) notes.push(`thin: ${fit.contrast.toFixed(1)} of ${priorEpisodes} contrast`);
  return notes.join('; ');
}

function signalTable(fits: SignalFit[], priorEpisodes: number, withCurrent: boolean): string {
  const showScore = fits.some((fit) => fit.score !== fit.lift);
  const headers = [
    'signal',
    'weight',
    ...(withCurrent ? ['was'] : []),
    '90% interval',
    'lift',
    ...(showScore ? ['score'] : []),
    'with: hits / misses',
    'without: outcomes / episodes',
    'note',
  ];
  return table(
    headers,
    fits.map((f) => [
      f.signal,
      num(f.weight, 2),
      ...(withCurrent ? [num(f.current, 2)] : []),
      f.low === null || f.high === null
        ? 'no contrast'
        : `${f.low.toFixed(2)} to ${f.high.toFixed(2)}`,
      f.lift === null ? '' : signed(f.lift, 2),
      ...(showScore ? [f.score === null ? '' : signed(f.score, 2)] : []),
      `${f.hits} / ${f.misses}`,
      `${f.outcomesWithout} / ${f.without}`,
      note(f, priorEpisodes),
    ]),
  );
}

function formatIntent(fit: IntentFit): string {
  const out: string[] = [];
  const excluded =
    fit.excluded > 0 ? `, ${plural(fit.excluded, 'episode')} left out (a reveal was live)` : '';
  out.push(
    `${fit.intent}: outcome ${fit.outcome}, ${plural(fit.installs, 'install')}, ${plural(fit.episodes, 'counted episode')}, ${fit.outcomes} with the outcome${excluded}`,
  );
  out.push('');
  out.push(
    table(
      ['knob', 'fitted', 'was', 'from'],
      [
        [
          'prior',
          fit.prior.value.toFixed(4),
          String(fit.prior.current),
          `${fit.outcomes} of ${fit.episodes} episodes ended with the outcome, smoothed (${fit.outcomes}+1)/(${fit.episodes}+2)`,
        ],
        [
          'priorStrength',
          num(fit.priorStrength.value, 1),
          num(fit.priorStrength.current, 1),
          fit.priorStrength.note,
        ],
        [
          'halfLife',
          formatDuration(fit.halfLife.value),
          formatDuration(fit.halfLife.current),
          fit.halfLife.note,
        ],
      ],
    ),
  );
  out.push('');
  if (fit.signals.length === 0) {
    out.push('No declared signals.');
  } else {
    out.push(signalTable(fit.signals, fit.priorEpisodes, true));
  }
  out.push('');
  out.push(
    `Half-life grid, Brier score against "the outcome follows within ${formatDuration(fit.halfLife.window)}"${fit.halfLife.windowSource === 'halfLife' ? " (the intent's half-life, since its reveal cooldown is 0)" : ''} (lower is better): ${fit.halfLife.curve
      .map(
        (p) =>
          `${formatDuration(p.halfLife)} ${num(p.brier, 4)}${p.halfLife === fit.halfLife.value && p.brier !== null ? ' *' : ''}`,
      )
      .join(', ')}`,
  );
  if (fit.beatsBaseRate === false) {
    const scored = fit.halfLife.curve.find((p) => p.halfLife === fit.halfLife.value);
    const window = formatDuration(fit.halfLife.window);
    const why = fit.signals.some((f) => f.weight !== null)
      ? `Its signals do not separate the events that ${fit.outcome} follows within ${window} from the rest.`
      : `No signal is left in the config, so p never leaves the prior, and the prior (the share of episodes that end with ${fit.outcome}) is not the share of events that ${fit.outcome} follows within ${window}.`;
    out.push('');
    out.push(
      `This intent does not beat its base rate: the fitted config scores ${num(scored?.brier ?? null, 4)} where always predicting the base rate scores ${num(fit.halfLife.brierBaseline, 4)} (lower is better). ${why} Drop the intent, or find signals that tell its episodes apart (--all-events measures every other event in the log).`,
    );
  }
  if (fit.candidates.length > 0) {
    out.push('');
    out.push(
      'Candidates: every other event in the log, measured the same way. Add one as a signal only if it says something your signals do not already say.',
    );
    out.push(signalTable(fit.candidates, fit.priorEpisodes, false));
  }
  return out.join('\n');
}

/** The report as text for a terminal: a header, one section per intent, then the config to paste. */
export function formatTuneText(report: TuneReport): string {
  const out: string[] = [];
  out.push(
    `oracular tune: ${plural(report.installs, 'install')}, ${report.records} records (${report.shadow} shadow, ${report.live} live), ${formatTime(report.start)} to ${formatTime(report.end)}`,
  );
  out.push(
    `Counted: ${report.scored === 'shadow' ? 'shadow episodes only' : 'every episode, live included'}. Durations assume \`at\` is in milliseconds. Every number is a starting point: the engine corrects the weights per user.`,
  );
  for (const intent of report.intents) {
    out.push('');
    out.push(formatIntent(intent));
  }
  for (const { intent, reason } of report.skipped) {
    out.push('');
    out.push(`${intent}: skipped, ${reason}.`);
  }
  if (report.intents.length > 0) {
    out.push('');
    out.push(
      'Config with every fitted value swapped in (paste it, or pass it to oracular replay --config):',
    );
    out.push(JSON.stringify(report.config, null, 2));
  }
  return `${out.join('\n')}\n`;
}

export function formatTuneJson(report: TuneReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
