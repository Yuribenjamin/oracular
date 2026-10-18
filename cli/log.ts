// Reads recorder logs (NDJSON, format version 1) into replay entries. Validates every line and
// names the file and line of anything it cannot use.
import { RECORD_VERSION } from 'oracular';

export type Mode = 'shadow' | 'live';

/** One usable line of a recorder log. Decisions are not here: replay and tune never read them. */
export type LogEntry =
  | { kind: 'event'; installId: string; mode: Mode; name: string; at: number }
  | { kind: 'end'; installId: string; mode: Mode; at: number };

/** A recorder log that cannot be replayed, with the file and line at fault. */
export class LogError extends Error {
  override name = 'LogError';
}

export interface ParsedLog {
  entries: LogEntry[];
  /** Notes for the user: records skipped because their kind is newer than this replay. */
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface GroupedLog {
  /** Each install's entries in time order (stable for equal times); installs in order of first appearance. */
  byInstall: Map<string, LogEntry[]>;
  start: number | null;
  end: number | null;
  shadow: number;
  live: number;
  /** Installs whose records include both modes. */
  mixedInstalls: number;
}

/** Groups entries by install, keeping file order between installs, and sums up what the log holds. */
export function groupByInstall(entries: readonly LogEntry[]): GroupedLog {
  const byInstall = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const list = byInstall.get(entry.installId);
    if (list === undefined) byInstall.set(entry.installId, [entry]);
    else list.push(entry);
  }
  let start: number | null = null;
  let end: number | null = null;
  let shadow = 0;
  let live = 0;
  let mixedInstalls = 0;
  for (const list of byInstall.values()) {
    list.sort((a, b) => a.at - b.at);
    const modes = new Set(list.map((e) => e.mode));
    if (modes.size > 1) mixedInstalls++;
    for (const e of list) {
      if (e.mode === 'shadow') shadow++;
      else live++;
      start = start === null ? e.at : Math.min(start, e.at);
      end = end === null ? e.at : Math.max(end, e.at);
    }
  }
  return { byInstall, start, end, shadow, live, mixedInstalls };
}

/** Parses one log file's text. Blank lines are ignored; everything else must be a v1 record. */
export function parseLog(text: string, source: string): ParsedLog {
  const entries: LogEntry[] = [];
  const unknownKinds = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    if (raw.trim() === '') continue;
    const where = `${source}:${i + 1}`;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new LogError(`${where}: not valid JSON`);
    }
    if (!isObject(record)) throw new LogError(`${where}: a record must be a JSON object`);
    if (record.v !== RECORD_VERSION) {
      throw new LogError(
        `${where}: recorder format v${String(record.v)} is not supported (this replay reads v${RECORD_VERSION})`,
      );
    }
    const { installId, mode, kind } = record;
    if (typeof installId !== 'string' || installId === '') {
      throw new LogError(`${where}: installId must be a non-empty string`);
    }
    if (mode !== 'shadow' && mode !== 'live') {
      throw new LogError(`${where}: mode must be "shadow" or "live"`);
    }
    if (kind === 'event') {
      const event = record.event;
      if (!isObject(event) || typeof event.name !== 'string' || event.name === '') {
        throw new LogError(`${where}: event.name must be a non-empty string`);
      }
      if (typeof event.at !== 'number' || !Number.isFinite(event.at)) {
        throw new LogError(`${where}: event.at must be a finite number`);
      }
      entries.push({ kind, installId, mode, name: event.name, at: event.at });
    } else if (kind === 'end') {
      if (typeof record.at !== 'number' || !Number.isFinite(record.at)) {
        throw new LogError(`${where}: at must be a finite number`);
      }
      entries.push({ kind, installId, mode, at: record.at });
    } else {
      const label = typeof kind === 'string' ? kind : String(kind);
      unknownKinds.set(label, (unknownKinds.get(label) ?? 0) + 1);
    }
  }
  const warnings = [...unknownKinds].map(
    ([kind, n]) => `${source}: skipped ${n} record${n === 1 ? '' : 's'} of unknown kind "${kind}"`,
  );
  return { entries, warnings };
}
