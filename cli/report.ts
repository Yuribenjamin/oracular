// Turns a replay report into the text a person reads in a terminal, or into JSON.
import type { IntentReport, ReplayReport } from './replay';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A duration in milliseconds as its two largest units: 2d 3h, 1h 30m, 45m, 30s, 850ms. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < SECOND) return `${Math.round(ms)}ms`;
  const units: Array<[number, string]> = [
    [DAY, 'd'],
    [HOUR, 'h'],
    [MINUTE, 'm'],
    [SECOND, 's'],
  ];
  const rounded = Math.round(ms / SECOND) * SECOND;
  const i = units.findIndex(([size]) => rounded >= size);
  const [size, label] = units[i] as [number, string];
  const n = Math.floor(rounded / size);
  const next = units[i + 1];
  if (next === undefined) return `${n}${label}`;
  const m = Math.floor((rounded - n * size) / next[0]);
  return m > 0 ? `${n}${label} ${m}${next[1]}` : `${n}${label}`;
}

/** A timestamp as a UTC date when it looks like epoch milliseconds, otherwise as the number itself. */
export function formatTime(at: number | null): string {
  if (at === null) return '–';
  if (at >= 1e11 && at <= 1e14)
    return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return String(at);
}

export const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}%`);
export const num = (x: number | null, digits: number) => (x === null ? '–' : x.toFixed(digits));

/** A Markdown-style table whose columns are padded to their widest cell. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] as string).length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] as number)).join(' | ')} |`;
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function formatIntent(intent: IntentReport): string {
  const window = formatDuration(intent.window);
  const source = intent.windowIsCooldown ? "the intent's reveal cooldown" : 'as given';
  const out: string[] = [];
  out.push(
    `${intent.intent}: outcome ${intent.outcome}, window ${window} (${source}), ${intent.installs} install${intent.installs === 1 ? '' : 's'}`,
  );
  out.push('');
  out.push(
    table(
      ['threshold', 'reveals', 'per user', 'precision', 'recall', 'median lead time'],
      intent.thresholds.map((t) => [
        `${t.threshold}${t.configured ? ' *' : ''}`,
        String(t.reveals),
        num(t.revealsPerUser, 2),
        pct(t.precision),
        `${pct(t.recall)} of ${t.outcomes}`,
        formatDuration(t.leadTime),
      ]),
    ),
  );
  const censored = intent.thresholds.reduce((acc, t) => Math.max(acc, t.censored), 0);
  out.push(
    `* the threshold your config resolves for this intent.${censored > 0 ? ` Reveals whose window runs past the end of the log are not scored (up to ${censored} per threshold).` : ''}`,
  );
  out.push('');
  out.push(
    `Reliability: p after every event except the outcome, against "the outcome follows within ${window}".`,
  );
  if (intent.points === 0) {
    out.push('No scored points.');
  } else {
    out.push(
      table(
        ['p', 'points', 'mean p', 'observed'],
        intent.reliability.map((b) => [
          `${b.from.toFixed(1)}–${b.to.toFixed(1)}`,
          String(b.count),
          b.meanP.toFixed(3),
          pct(b.observed),
        ]),
      ),
    );
    out.push(
      `Brier score ${num(intent.brier, 3)} over ${intent.points} points (always predicting the base rate of ${pct(intent.baseRate)}: ${num(intent.brierBaseline, 3)}). Lower is better.${intent.censored > 0 ? ` ${intent.censored} points too close to the end of the log are not scored.` : ''}`,
    );
  }
  return out.join('\n');
}

/** The report as text for a terminal: a header, then one section per intent. */
export function formatText(report: ReplayReport): string {
  const out: string[] = [];
  out.push(
    `oracular replay: ${report.installs} install${report.installs === 1 ? '' : 's'}, ${report.records} records (${report.shadow} shadow, ${report.live} live), ${formatTime(report.start)} to ${formatTime(report.end)}`,
  );
  out.push(
    `Scored: ${report.scored === 'shadow' ? 'shadow periods only' : 'every record, live included'}. Durations assume \`at\` is in milliseconds.`,
  );
  for (const intent of report.intents) {
    out.push('');
    out.push(formatIntent(intent));
  }
  for (const { intent, reason } of report.skipped) {
    out.push('');
    out.push(`${intent}: skipped, ${reason}.`);
  }
  return `${out.join('\n')}\n`;
}

export function formatJson(report: ReplayReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
