// The dumb baseline every reviewer asks about: "reveal when cart.added has happened k times in
// this session", scored exactly as `oracular replay` scores a reveal. Same session rule (30 idle
// minutes), same window (an order within a day counts), same quiet period (no second reveal for a
// day after a reveal or an order), same censoring (a window that runs past the end of the log is
// not scored). A rule has no probability, so there is no Brier score to compare; precision and
// recall at the same operating point are the fair comparison.
//
// The stateful variant isolates what Bayesian learning buys over a trivially stateful heuristic:
// "third cart add, unless this visitor has had N or more cart sessions without an order since
// their last order". Pass it as k:N, for example 3:2.
//
//   node examples/retailrocket/baseline-rules.mjs <holdout.ndjson> [k | k:N ...]
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const [logPath, ...ks] = process.argv.slice(2);
const RULES = (ks.length > 0 ? ks : ['1', '2', '3', '4']).map((arg) => {
  const [k, n] = arg.split(':');
  return { k: Number(k), skipAfter: n === undefined ? null : Number(n) };
});
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const GAP = 30 * MINUTE;
const WINDOW = DAY;
const QUIET = DAY;

const byInstall = new Map();
let logEnd = 0;
const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (r.kind !== 'event') continue;
  let list = byInstall.get(r.installId);
  if (!list) {
    list = [];
    byInstall.set(r.installId, list);
  }
  list.push([r.event.at, r.event.name]);
  if (r.event.at > logEnd) logEnd = r.event.at;
}

function score({ k, skipAfter }) {
  const t = { k, skipAfter, reveals: 0, correct: 0, censored: 0, outcomes: 0, caught: 0, leads: [] };
  for (const events of byInstall.values()) {
    events.sort((a, b) => a[0] - b[0]);
    const orders = events.filter(([, name]) => name === 'order.placed').map(([at]) => at);
    const reveals = [];
    let carts = 0;
    let quietUntil = -Infinity;
    let last = -Infinity;
    // The stateful rule's memory: cart sessions that ended without an order since the last order.
    let fruitless = 0;
    let sessionHadCart = false;
    let sessionHadOrder = false;
    const closeSession = () => {
      if (sessionHadCart && !sessionHadOrder) fruitless++;
      sessionHadCart = false;
      sessionHadOrder = false;
    };
    for (const [at, name] of events) {
      if (at - last > GAP) {
        closeSession();
        carts = 0; // a new session
      }
      last = at;
      if (name === 'order.placed') {
        carts = 0; // the engine resets on the outcome and starts its cooldown
        quietUntil = at + QUIET;
        sessionHadOrder = true;
        fruitless = 0;
        continue;
      }
      if (name !== 'cart.added') continue;
      carts++;
      sessionHadCart = true;
      const skip = skipAfter !== null && fruitless >= skipAfter;
      if (carts >= k && at >= quietUntil && !skip) {
        reveals.push(at);
        quietUntil = at + QUIET;
      }
    }
    for (const r of reveals) {
      if (r + WINDOW > logEnd) {
        t.censored++;
        continue;
      }
      t.reveals++;
      const o = orders.find((x) => x > r && x <= r + WINDOW);
      if (o !== undefined) {
        t.correct++;
        t.leads.push(o - r);
      }
    }
    for (const o of orders) {
      t.outcomes++;
      if (reveals.some((r) => r >= o - WINDOW && r < o)) t.caught++;
    }
  }
  t.leads.sort((a, b) => a - b);
  const mid = Math.floor(t.leads.length / 2);
  t.medianLead = t.leads.length === 0 ? null : t.leads.length % 2 ? t.leads[mid] : (t.leads[mid - 1] + t.leads[mid]) / 2;
  return t;
}

console.log(`${byInstall.size} visitors; window ${WINDOW / DAY} day, quiet ${QUIET / DAY} day after a reveal or an order`);
console.log('| rule | reveals | precision | recall | median lead |');
console.log('| --- | --- | --- | --- | --- |');
for (const rule of RULES) {
  const t = score(rule);
  const pct = (a, b) => (b === 0 ? '–' : `${((100 * a) / b).toFixed(1)}%`);
  const lead = t.medianLead === null ? '–' : `${Math.round(t.medianLead / MINUTE)} min`;
  const memory =
    rule.skipAfter === null
      ? ''
      : `, unless ${rule.skipAfter}+ cart sessions without an order since the last order`;
  console.log(`| cart.added ≥ ${rule.k} in a session${memory} | ${t.reveals} | ${pct(t.correct, t.reveals)} | ${pct(t.caught, t.outcomes)} of ${t.outcomes} | ${lead} |`);
}
