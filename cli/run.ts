// The `oracular` command: argument parsing (by hand, so there are no runtime dependencies), file
// reading and printing around the pure replay and tune. Everything with side effects comes in
// through `io`.
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type EngineConfig, validateConfig } from 'oracular';
import { type LogEntry, parseLog } from './log';
import { type ReplayOptions, type ReplayReport, replay } from './replay';
import { formatJson, formatText } from './report';
import { MIN_INSTALLS_FOR_SPREAD, type TuneOptions, type TuneReport, tune } from './tune';
import { formatTuneJson, formatTuneText } from './tune-report';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => string;
  cwd: string;
}

/** Bad arguments: exit code 2 and a pointer to --help. */
class UsageError extends Error {}

const DOCS = 'https://yuribenjamin.github.io/oracular/guide/shadow-mode';

const USAGE = `Usage: oracular <command> [options]

Commands:
  replay <log.ndjson>... --config <file>   score a recorder log against a config: precision,
                                           recall, lead time, reveals per user and calibration
  tune <log.ndjson>... --config <file>     seed a config from a recorder log: prior, prior
                                           strength, weights and half-life, read off what the
                                           engine itself counts

Run "oracular <command> --help" for the command's options.
  -h, --help             show this help
  -v, --version          print the version

Docs: ${DOCS}
`;

const REPLAY_HELP = `Usage: oracular replay <log.ndjson>... --config <file> [options]

Replays a recorder log (see the Shadow mode guide) through the engine under a config, and
reports for every intent and threshold: precision, recall, lead time from reveal to outcome,
reveals per user, and a reliability table with a Brier score.

Options:
  --config <file>        the config to replay under: a .json file, or a .js, .mjs or .cjs
                         module whose default (or \`config\`) export is the config. A top-level
                         "$schema" key in a .json file is ignored
  --thresholds <list>    thresholds to score, comma separated
                         (default: 0.3 to 0.9 by 0.1, plus each intent's configured threshold)
  --window <duration>    how long after a reveal an outcome still counts for it: 3d, 12h, 90m
                         (default: each intent's reveal cooldown; needed when that is 0).
                         A plain number is in the unit of \`at\`; the suffixes ms, s, m, h, d
                         and w assume milliseconds
  --intent <name>        score only this intent; repeat for more
                         (default: every intent that declares an outcome)
  --include-live         also score live periods. While reveals are shown they cause outcomes,
                         so precision and recall there overstate the engine
  --json                 print the report as JSON
  -h, --help             show this help
  -v, --version          print the version

Only shadow periods are scored by default; a log with live records gets a warning, and a log
with nothing but live records is refused unless --include-live is given.

Exit codes: 0 report printed, 1 unreadable input or nothing to score, 2 usage error.
Docs: ${DOCS}
`;

const TUNE_HELP = `Usage: oracular tune <log.ndjson>... --config <file> [options]

Seeds a config from a recorder log (see the Shadow mode guide). Grouped by install, it reads what
the engine itself counts: the base rate becomes the prior, the spread of per-install base rates
the prior strength, each signal's lift over the episodes without it its weight, and the half-life
that predicts the log best under replay (lowest Brier score) wins a grid search. Prints the fit,
with sample sizes and a 90% interval per weight, and the config to paste.

Options:
  --config <file>        the config to start from: a .json file, or a .js, .mjs or .cjs module
                         whose default (or \`config\`) export is the config. A top-level "$schema"
                         key in a .json file is ignored. Its intents, outcome names and signals
                         say what to fit; what tune cannot read from the log is kept as it is
  --intent <name>        fit only this intent; repeat for more
                         (default: every intent that declares an outcome)
  --half-lives <list>    half-lives to try, comma separated: 12h,1d,3d,7d
                         (default: 1h, 6h, 1d, 3d, 7d, 14d, 30d, plus the intent's current value)
  --window <duration>    how long after a point an outcome still counts for it when the grid is
                         scored: 3d, 12h, 90m (default: each intent's reveal cooldown; needed
                         when that is 0). A plain number is in the unit of \`at\`; the suffixes
                         ms, s, m, h, d and w assume milliseconds
  --all-events           also measure every other event name in the log as a candidate signal
  --include-live         also count episodes in which reveals were live. While reveals are
                         shown they cause outcomes, so the prior and weights there overstate
                         the signals
  --json                 print the report as JSON
  -h, --help             show this help

Only shadow periods are counted by default: an episode in which any record was live is left out,
a log with live records gets a warning, and a log with nothing but live records is refused unless
--include-live is given. Every number is a starting point: the engine corrects weights per user.

Exit codes: 0 report printed, 1 unreadable input or nothing to fit, 2 usage error.
Docs: ${DOCS}#tune
`;

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDuration(text: string, flag: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)?$/.exec(text.trim());
  const value =
    match === null ? Number.NaN : Number(match[1]) * (UNITS[match[2] ?? 'ms'] as number);
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new UsageError(
      `${flag} must be a positive duration such as 3d, 12h, 90m or 5000, got ${JSON.stringify(text)}`,
    );
  }
  return value;
}

function parseThresholds(text: string): number[] {
  return text.split(',').map((part) => {
    const t = Number(part.trim());
    if (part.trim() === '' || !Number.isFinite(t) || t < 0 || t > 1) {
      throw new UsageError(
        `--thresholds must be numbers between 0 and 1, got ${JSON.stringify(part)}`,
      );
    }
    return t;
  });
}

function parseDurations(text: string, flag: string): number[] {
  return text.split(',').map((part) => parseDuration(part, flag));
}

type Flags = Record<string, (value: () => string, noValue: () => void) => void>;

/**
 * Walks argv: `--flag value` and `--flag=value` go to their handler, anything else starting with a
 * dash is an unknown option, and the rest are positional.
 */
function parseFlags(
  argv: readonly string[],
  flags: Flags,
  positional: (arg: string) => void,
): void {
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i] as string;
    let inline: string | undefined;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      inline = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--'))
        throw new UsageError(`${flag} needs a value`);
      i++;
      return next;
    };
    const noValue = () => {
      if (inline !== undefined) throw new UsageError(`${flag} takes no value`);
    };
    const handler = flags[flag];
    if (handler !== undefined) handler(value, noValue);
    else if (flag.startsWith('-')) throw new UsageError(`unknown option ${flag}`);
    else positional(flag);
  }
}

/** What replay and tune share: the logs, the config, the intents to look at, and the live switch. */
interface CommonArgs {
  logs: string[];
  config?: string;
  intents?: string[];
  window?: number;
  includeLive: boolean;
  json: boolean;
  help: boolean;
}

function commonFlags(out: CommonArgs): Flags {
  return {
    '--config': (value) => {
      out.config = value();
    },
    '--window': (value) => {
      out.window = parseDuration(value(), '--window');
    },
    '--intent': (value) => {
      out.intents = [...(out.intents ?? []), value()];
    },
    '--include-live': (_value, noValue) => {
      noValue();
      out.includeLive = true;
    },
    '--json': (_value, noValue) => {
      noValue();
      out.json = true;
    },
    '--help': () => {
      out.help = true;
    },
    '-h': () => {
      out.help = true;
    },
  };
}

function requireLogsAndConfig(out: CommonArgs, command: string): void {
  if (out.help) return;
  if (out.logs.length === 0) throw new UsageError(`${command} needs at least one log file`);
  if (out.config === undefined) throw new UsageError(`${command} needs --config <file>`);
}

interface ReplayArgs extends CommonArgs {
  thresholds?: number[];
}

function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  const out: ReplayArgs = { logs: [], includeLive: false, json: false, help: false };
  parseFlags(
    argv,
    {
      ...commonFlags(out),
      '--thresholds': (value) => {
        out.thresholds = parseThresholds(value());
      },
    },
    (arg) => out.logs.push(arg),
  );
  requireLogsAndConfig(out, 'replay');
  return out;
}

interface TuneArgs extends CommonArgs {
  halfLives?: number[];
  allEvents: boolean;
}

function parseTuneArgs(argv: readonly string[]): TuneArgs {
  const out: TuneArgs = {
    logs: [],
    includeLive: false,
    json: false,
    help: false,
    allEvents: false,
  };
  parseFlags(
    argv,
    {
      ...commonFlags(out),
      '--half-lives': (value) => {
        out.halfLives = parseDurations(value(), '--half-lives');
      },
      '--all-events': (_value, noValue) => {
        noValue();
        out.allEvents = true;
      },
    },
    (arg) => out.logs.push(arg),
  );
  requireLogsAndConfig(out, 'tune');
  return out;
}

function version(): string {
  // ../package.json from both cli/run.ts and the built dist/cli.js.
  return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
}

async function loadConfig(path: string, io: Io): Promise<EngineConfig> {
  const ext = extname(path);
  let value: unknown;
  if (ext === '.json') {
    try {
      value = JSON.parse(io.readFile(path));
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`);
    }
    // A JSON config may point at the published schema for editor support. The engine rejects
    // unknown keys, so the pointer is dropped here and nowhere else.
    if (typeof value === 'object' && value !== null && '$schema' in value) {
      value = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema'));
    }
  } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    value = mod.default ?? mod.config;
    // A CommonJS module that assigns module.exports = { config } arrives as default.config.
    if (typeof value === 'object' && value !== null && !('intents' in value) && 'config' in value) {
      value = (value as { config: unknown }).config;
    }
  } else {
    throw new UsageError('--config must be a .json, .js, .mjs or .cjs file');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${path} holds no config object`);
  }
  return value as EngineConfig;
}

/** Loads and validates the config, and checks every --intent against it. */
async function loadCheckedConfig(args: CommonArgs, io: Io): Promise<EngineConfig> {
  const configPath = resolve(io.cwd, args.config as string);
  const config = await loadConfig(configPath, io);
  let declared: string[];
  try {
    declared = Object.keys(validateConfig(config).intents);
  } catch (error) {
    throw new Error(
      `${configPath} is not a valid config: ${(error as Error).message.replace(/^oracular: /, '')}`,
    );
  }
  for (const name of args.intents ?? []) {
    if (!declared.includes(name)) {
      throw new UsageError(`--intent ${name}: the config declares ${declared.join(', ')}`);
    }
  }
  return config;
}

/** Reads every log file, printing the parser's warnings. */
function readLogs(files: readonly string[], io: Io): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const file of files) {
    const parsed = parseLog(io.readFile(resolve(io.cwd, file)), file);
    for (const warning of parsed.warnings) io.stderr(`oracular: warning: ${warning}\n`);
    entries.push(...parsed.entries);
  }
  if (entries.length === 0) throw new Error('the log holds no records');
  return entries;
}

/** The shadow/live policy both commands follow: refuse a live-only log, warn about a mixed one. */
function checkModes(
  entries: readonly LogEntry[],
  includeLive: boolean,
  io: Io,
  wording: {
    refused: string;
    mixed: (live: number, total: number) => string;
    included: (live: number) => string;
  },
): void {
  const live = entries.filter((e) => e.mode === 'live').length;
  const shadow = entries.length - live;
  if (shadow === 0 && !includeLive) throw new Error(wording.refused);
  if (live > 0 && !includeLive)
    io.stderr(`oracular: warning: ${wording.mixed(live, entries.length)}\n`);
  if (live > 0 && includeLive) io.stderr(`oracular: warning: ${wording.included(live)}\n`);
}

async function replayCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseReplayArgs(argv);
  if (args.help) {
    io.stdout(REPLAY_HELP);
    return 0;
  }
  const config = await loadCheckedConfig(args, io);
  const entries = readLogs(args.logs, io);
  checkModes(entries, args.includeLive, io, {
    refused:
      'every record in the log is live, so there is nothing to measure. Replay measures the engine where reveals were not shown; once they are, the reveal itself causes outcomes. Pass --include-live to score the live records anyway, knowing precision and recall are contaminated.',
    mixed: (live, total) =>
      `the log mixes shadow and live records (${live} of ${total} live). Only shadow periods are scored: a reveal, point or outcome whose window touches a live record is left out. Pass --include-live to score everything.`,
    included: (live) =>
      `scoring ${live} live records as asked. While reveals are shown they cause outcomes, so precision and recall over live periods overstate the engine.`,
  });

  const options: ReplayOptions = { includeLive: args.includeLive };
  if (args.thresholds !== undefined) options.thresholds = args.thresholds;
  if (args.window !== undefined) options.window = args.window;
  if (args.intents !== undefined) options.intents = args.intents;
  let report: ReplayReport;
  try {
    report = replay(entries, config, options);
  } catch (error) {
    // replay's own RangeErrors are about the arguments: an empty scoring window, an unknown intent.
    if (error instanceof RangeError) throw new UsageError(error.message);
    throw error;
  }
  io.stdout(args.json ? formatJson(report) : formatText(report));
  return 0;
}

async function tuneCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseTuneArgs(argv);
  if (args.help) {
    io.stdout(TUNE_HELP);
    return 0;
  }
  const config = await loadCheckedConfig(args, io);
  const entries = readLogs(args.logs, io);
  checkModes(entries, args.includeLive, io, {
    refused:
      'every record in the log is live, so there is nothing to fit. Tune reads the engine where reveals were not shown; once they are, the reveal itself causes outcomes. Pass --include-live to count the live episodes anyway, knowing the prior and the weights are contaminated.',
    mixed: (live, total) =>
      `the log mixes shadow and live records (${live} of ${total} live). Only shadow episodes are counted: an episode in which any record was live is left out. Pass --include-live to count everything.`,
    included: (live) =>
      `counting ${live} live records as asked. While reveals are shown they cause outcomes, so the prior and the weights fitted over live periods overstate the signals.`,
  });

  const options: TuneOptions = { includeLive: args.includeLive, allEvents: args.allEvents };
  if (args.halfLives !== undefined) options.halfLives = args.halfLives;
  if (args.window !== undefined) options.window = args.window;
  if (args.intents !== undefined) options.intents = args.intents;
  let report: TuneReport;
  try {
    report = tune(entries, config, options);
  } catch (error) {
    if (error instanceof RangeError) throw new UsageError(error.message);
    throw error;
  }
  if (report.installs < 2 * MIN_INSTALLS_FOR_SPREAD) {
    io.stderr(
      `oracular: warning: ${report.installs} install${report.installs === 1 ? '' : 's'} in the log. Treat every number as a rough starting point: the spread of base rates needs ${MIN_INSTALLS_FOR_SPREAD} installs, and a weight needs episodes both with and without its signal.\n`,
    );
  }
  io.stdout(args.json ? formatTuneJson(report) : formatTuneText(report));
  return 0;
}

/** Runs the command line `argv` (without node and the script) and returns the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(USAGE);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      io.stdout(`${version()}\n`);
      return 0;
    }
    if (command === 'replay') return await replayCommand(rest, io);
    if (command === 'tune') return await tuneCommand(rest, io);
    throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`oracular: ${error.message}\nRun "oracular --help" for usage.\n`);
      return 2;
    }
    io.stderr(`oracular: ${(error as Error).message}\n`);
    return 1;
  }
}
