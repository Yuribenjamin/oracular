// The `oracular` command: argument parsing (by hand, so there are no runtime dependencies), file
// reading and printing around the pure replay. Everything with side effects comes in through `io`.
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createState, type EngineConfig } from 'oracular';
import { parseLog } from './log';
import { type LogEntry, type ReplayOptions, type ReplayReport, replay } from './replay';
import { formatJson, formatText } from './report';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => string;
  cwd: string;
}

/** Bad arguments: exit code 2 and a pointer to --help. */
class UsageError extends Error {}

const HELP = `Usage: oracular replay <log.ndjson>... --config <file> [options]

Replays a recorder log (see the Shadow mode guide) through the engine under a config, and
reports for every intent and threshold: precision, recall, lead time from reveal to outcome,
reveals per user, and a reliability table with a Brier score.

Options:
  --config <file>        the config to replay under: a .json file, or a .js, .mjs or .cjs
                         module whose default (or \`config\`) export is the config
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
Docs: https://yuribenjamin.github.io/oracular/guide/shadow-mode
`;

interface ReplayArgs {
  logs: string[];
  config?: string;
  thresholds?: number[];
  window?: number;
  intents?: string[];
  includeLive: boolean;
  json: boolean;
  help: boolean;
}

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDuration(text: string, flag: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)?$/.exec(text);
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

function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  const out: ReplayArgs = { logs: [], includeLive: false, json: false, help: false };
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
    switch (flag) {
      case '--config':
        out.config = value();
        break;
      case '--thresholds':
        out.thresholds = parseThresholds(value());
        break;
      case '--window':
        out.window = parseDuration(value(), '--window');
        break;
      case '--intent':
        out.intents = [...(out.intents ?? []), value()];
        break;
      case '--include-live':
        noValue();
        out.includeLive = true;
        break;
      case '--json':
        noValue();
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (flag.startsWith('-')) throw new UsageError(`unknown option ${flag}`);
        out.logs.push(flag);
    }
  }
  if (!out.help) {
    if (out.logs.length === 0) throw new UsageError('replay needs at least one log file');
    if (out.config === undefined) throw new UsageError('replay needs --config <file>');
  }
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

async function replayCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseReplayArgs(argv);
  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  const configPath = resolve(io.cwd, args.config as string);
  const config = await loadConfig(configPath, io);
  let declared: string[];
  try {
    declared = Object.keys(createState(config).config.intents);
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

  const entries: LogEntry[] = [];
  for (const file of args.logs) {
    const parsed = parseLog(io.readFile(resolve(io.cwd, file)), file);
    for (const warning of parsed.warnings) io.stderr(`oracular: warning: ${warning}\n`);
    entries.push(...parsed.entries);
  }
  if (entries.length === 0) throw new Error('the log holds no records');

  const live = entries.filter((e) => e.mode === 'live').length;
  const shadow = entries.length - live;
  if (shadow === 0 && !args.includeLive) {
    throw new Error(
      'every record in the log is live, so there is nothing to measure. Replay measures the engine where reveals were not shown; once they are, the reveal itself causes outcomes. Pass --include-live to score the live records anyway, knowing precision and recall are contaminated.',
    );
  }
  if (live > 0 && !args.includeLive) {
    io.stderr(
      `oracular: warning: the log mixes shadow and live records (${live} of ${entries.length} live). Only shadow periods are scored: a reveal, point or outcome whose window touches a live record is left out. Pass --include-live to score everything.\n`,
    );
  }
  if (live > 0 && args.includeLive) {
    io.stderr(
      `oracular: warning: scoring ${live} live records as asked. While reveals are shown they cause outcomes, so precision and recall over live periods overstate the engine.\n`,
    );
  }

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

/** Runs the command line `argv` (without node and the script) and returns the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(HELP);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      io.stdout(`${version()}\n`);
      return 0;
    }
    if (command !== 'replay') throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    return await replayCommand(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`oracular: ${error.message}\nRun "oracular --help" for usage.\n`);
      return 2;
    }
    io.stderr(`oracular: ${(error as Error).message}\n`);
    return 1;
  }
}
