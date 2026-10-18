// Converts the Retailrocket events.csv (Kaggle, retailrocket/ecommerce-dataset) into oracular
// recorder logs (format v1) and reports what the data looks like in episode terms.
//
//   node examples/retailrocket/convert.mjs <events.csv> <out dir>
//
// Writes <out dir>/fit.ndjson, <out dir>/holdout.ndjson and <out dir>/stats.json. Needs nothing
// but Node: the records are written by hand in the recorder format, since no app ran the engine
// over this data. See docs/guide/case-study-clickstream.md for what the files are for.
//
//   view        → item.viewed
//   addtocart   → cart.added
//   transaction → order.placed   (one per visitor + transactionid; the CSV has one row per item)
//
// installId = visitorid, mode = shadow. Visitors are split by parity of their id into fit.ndjson
// (tune reads this) and holdout.ndjson (replay scores this), so the fitted config is scored on
// people it never saw.
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [csv, outDir] = process.argv.slice(2);
if (!csv || !outDir) {
  console.error('usage: node examples/retailrocket/convert.mjs <events.csv> <out dir>');
  process.exit(2);
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SESSION_GAP = 30 * MINUTE;
const NAMES = { view: 'item.viewed', addtocart: 'cart.added', transaction: 'order.placed' };
const CODE = { view: 0, addtocart: 1, transaction: 2 };

const fit = createWriteStream(`${outDir}/fit.ndjson`);
const holdout = createWriteStream(`${outDir}/holdout.ndjson`);
const perVisitor = new Map(); // visitorid → flat array [ts, code, ts, code, …]
const seenTransactions = new Set();
const counts = { rows: 0, view: 0, addtocart: 0, transaction: 0, transactionRows: 0, written: 0 };

function write(stream, line) {
  if (!stream.write(line)) return new Promise((r) => stream.once('drain', r));
  return null;
}

const rl = createInterface({ input: createReadStream(csv), crlfDelay: Infinity });
let header = true;
for await (const line of rl) {
  if (header) {
    header = false;
    if (!line.startsWith('timestamp,visitorid,event,itemid,transactionid')) {
      throw new Error(`unexpected header: ${line}`);
    }
    continue;
  }
  if (line === '') continue;
  counts.rows++;
  const [tsText, visitor, event, , transaction] = line.split(',');
  const at = Number(tsText);
  if (!Number.isFinite(at) || !(event in NAMES)) throw new Error(`bad row ${counts.rows}: ${line}`);
  if (event === 'transaction') {
    counts.transactionRows++;
    const key = `${visitor}|${transaction}`;
    if (seenTransactions.has(key)) continue;
    seenTransactions.add(key);
  }
  counts[event]++;
  let list = perVisitor.get(visitor);
  if (list === undefined) {
    list = [];
    perVisitor.set(visitor, list);
  }
  list.push(at, CODE[event]);
  const record = `{"v":1,"kind":"event","installId":"${visitor}","mode":"shadow","event":{"name":"${NAMES[event]}","at":${at}},"decisions":{}}\n`;
  const pending = write(Number(visitor) % 2 === 0 ? fit : holdout, record);
  if (pending !== null) await pending;
  counts.written++;
}
await new Promise((r) => fit.end(r));
await new Promise((r) => holdout.end(r));

// ---- what the data looks like in episodes (30-minute idle gap, as the config will use) ----
const horizons = [1, 3, 7, 14, 30];
const stats = {
  visitors: perVisitor.size,
  fitVisitors: 0,
  holdoutVisitors: 0,
  sessions: 0,
  sessionsWithPurchase: 0,
  sessionsWithCart: 0,
  sessionsWithCartNoPurchase: 0,
  visitorsWithPurchase: 0,
  visitorsWithTwoOrMoreSessions: 0,
  purchaseSessions: 0,
  /** Purchase sessions preceded by at least one earlier session of the same visitor. */
  purchaseSessionsWithEarlierSession: 0,
  /** Purchase sessions where an earlier session had cart.added but no purchase, within d days of the purchase. */
  purchaseAfterCartSessionWithinDays: Object.fromEntries(horizons.map((d) => [d, 0])),
  /** Same, for any earlier session (a view is enough). */
  purchaseAfterAnySessionWithinDays: Object.fromEntries(horizons.map((d) => [d, 0])),
  /** Purchases that were the first event of their session (nothing in the session to credit). */
  purchasesFirstInSession: 0,
  purchases: counts.transaction,
  sessionsPerVisitor: { 1: 0, 2: 0, '3-5': 0, '6-10': 0, '11+': 0 },
  spanDays: null,
};
let minTs = Infinity;
let maxTs = -Infinity;
for (const [visitor, flat] of perVisitor) {
  if (Number(visitor) % 2 === 0) stats.fitVisitors++;
  else stats.holdoutVisitors++;
  const events = [];
  for (let i = 0; i < flat.length; i += 2) events.push([flat[i], flat[i + 1]]);
  events.sort((a, b) => a[0] - b[0]);
  minTs = Math.min(minTs, events[0][0]);
  maxTs = Math.max(maxTs, events[events.length - 1][0]);
  // sessions: { start, end, cart, purchase, purchaseTimes }
  const sessions = [];
  let current = null;
  let purchased = false;
  for (const [at, code] of events) {
    if (current === null || at - current.end > SESSION_GAP) {
      current = { start: at, end: at, cart: false, purchase: false, purchaseTimes: [], first: code };
      sessions.push(current);
    }
    current.end = at;
    if (code === 1) current.cart = true;
    if (code === 2) {
      current.purchase = true;
      current.purchaseTimes.push(at);
      purchased = true;
    }
  }
  if (purchased) stats.visitorsWithPurchase++;
  if (sessions.length >= 2) stats.visitorsWithTwoOrMoreSessions++;
  const n = sessions.length;
  const bucket = n === 1 ? 1 : n === 2 ? 2 : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '11+';
  stats.sessionsPerVisitor[bucket]++;
  stats.sessions += n;
  for (const [i, s] of sessions.entries()) {
    if (s.cart) stats.sessionsWithCart++;
    if (s.cart && !s.purchase) stats.sessionsWithCartNoPurchase++;
    if (!s.purchase) continue;
    stats.sessionsWithPurchase++;
    stats.purchaseSessions++;
    if (s.first === 2) stats.purchasesFirstInSession++;
    if (i === 0) continue;
    stats.purchaseSessionsWithEarlierSession++;
    const t = s.purchaseTimes[0];
    const earlier = sessions.slice(0, i);
    for (const d of horizons) {
      const within = (e) => t - e.end <= d * DAY;
      if (earlier.some((e) => within(e))) stats.purchaseAfterAnySessionWithinDays[d]++;
      if (earlier.some((e) => e.cart && !e.purchase && within(e))) {
        stats.purchaseAfterCartSessionWithinDays[d]++;
      }
    }
  }
}
stats.spanDays = Math.round((maxTs - minTs) / DAY);
const report = { counts, stats, start: new Date(minTs).toISOString(), end: new Date(maxTs).toISOString() };
writeFileSync(`${outDir}/stats.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
