// The returning visitors of a recorder log: the installs with three or more sessions, a session
// ending after 30 idle minutes, the gap the case study and `baseline-rules.mjs` use. Sessions are
// counted from the events' timestamps alone. Every line of a kept install is copied as it is, in
// file order, so the output is a recorder log that `replay` and `baseline-rules.mjs` read like the
// original. Two passes over the file; memory is one timestamp per event, not the log.
//
//   node examples/retailrocket/returning.mjs <in.ndjson> <out.ndjson>
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node examples/retailrocket/returning.mjs <in.ndjson> <out.ndjson>');
  process.exit(2);
}

const MINUTE = 60_000;
const GAP = 30 * MINUTE;
const MIN_SESSIONS = 3;

const lines = () => createInterface({ input: createReadStream(inPath), crlfDelay: Infinity });

const times = new Map();
for await (const line of lines()) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (r.kind !== 'event') continue;
  let list = times.get(r.installId);
  if (!list) {
    list = [];
    times.set(r.installId, list);
  }
  list.push(r.event.at);
}

const returning = new Set();
for (const [installId, list] of times) {
  list.sort((a, b) => a - b);
  let sessions = 1;
  for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] > GAP) sessions++;
  if (sessions >= MIN_SESSIONS) returning.add(installId);
}
const installs = times.size;
times.clear();

const out = createWriteStream(outPath);
let written = 0;
for await (const line of lines()) {
  if (!line || !returning.has(JSON.parse(line).installId)) continue;
  if (!out.write(`${line}\n`)) await once(out, 'drain');
  written++;
}
out.end();
await once(out, 'finish');

console.log(
  `${returning.size} of ${installs} installs have ${MIN_SESSIONS} or more sessions; ${written} records written`,
);
