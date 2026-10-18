// An app's view of the engine on real visitors: every returning buyer in a recorder log (three or
// more sessions and at least one order) is run through two engines, one with attribution set to
// the intent's half-life and one without, exactly as an app would call them, persisting the state
// at every episode close.
//
//   node examples/retailrocket/returning-buyers.mjs <holdout.ndjson> <config.json>
//
// The config must declare a `purchase` intent with the outcome `order.placed` and a `cart.added`
// signal (the one tune fits on this data). Imports 'oracular', so run it from a project that has
// the package installed, or from this repository after `npm run build`.
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  createState,
  deserialize,
  endEpisode,
  episodeClosed,
  explain,
  observe,
  predict,
  serialize,
  shouldReveal,
  STATE_VERSION,
  validateConfig,
} from 'oracular';

const [logPath, configPath] = process.argv.slice(2);
const DAY = 86_400_000;
const config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
const { purchase } = config.intents;
const attributed = {
  ...config,
  intents: { ...config.intents, purchase: { ...purchase, attribution: purchase.halfLife } },
};
console.log(`oracular STATE_VERSION ${STATE_VERSION}; attribution window ${attributed.intents.purchase.attribution / 3_600_000} h`);

// ---- group the holdout by visitor ----
const byInstall = new Map();
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
}
const GAP = config.episodeTimeout;
const returning = [];
for (const [id, events] of byInstall) {
  events.sort((a, b) => a[0] - b[0]);
  let sessions = 1;
  let orders = 0;
  for (let i = 0; i < events.length; i++) {
    if (i > 0 && events[i][0] - events[i - 1][0] > GAP) sessions++;
    if (events[i][1] === 'order.placed') orders++;
  }
  if (sessions >= 3 && orders >= 1) returning.push([id, events]);
}
console.log(`${byInstall.size} visitors in the holdout; ${returning.length} returning buyers (3+ sessions, 1+ order)`);

// ---- run each returning buyer through both engines, as an app would ----
const tally = (label) => ({
  label, visitors: 0, orders: 0, pBeforeOrder: 0, revealsBeforeOrder: 0, reveals: 0,
  pendingMax: 0, roundTrips: 0, cartHits: 0, cartMisses: 0, fractionalHits: 0, errors: 0,
});
const off = tally('attribution off');
const on = tally('attribution = halfLife');
const examples = [];
for (const [id, events] of returning) {
  for (const [cfg, t] of [[config, off], [attributed, on]]) {
    let s = createState(cfg);
    let revealedAt = null;
    t.visitors++;
    for (let i = 0; i < events.length; i++) {
      const [at, name] = events[i];
      if (name === 'order.placed') {
        const { p } = predict(s, 'purchase', at);
        t.orders++;
        t.pBeforeOrder += p;
        if (revealedAt !== null && at - revealedAt <= DAY) t.revealsBeforeOrder++;
      }
      const next = observe(s, { name, at });
      if (episodeClosed(s, next)) {
        // Persist on every close, as the docs suggest, and prove the round trip is lossless.
        const back = deserialize(serialize(next), { config: cfg });
        if (JSON.stringify(back) !== JSON.stringify(next)) t.errors++;
        t.roundTrips++;
      }
      s = next;
      t.pendingMax = Math.max(t.pendingMax, s.intents.purchase.pending.length);
      if (name !== 'order.placed' && shouldReveal(s, 'purchase', at, { threshold: 0.3 })) {
        t.reveals++;
        revealedAt = at;
      }
    }
    s = endEpisode(s, events[events.length - 1][0] + GAP + 1);
    const cart = s.intents.purchase.learned['cart.added'] ?? { hits: 0, misses: 0 };
    t.cartHits += cart.hits;
    t.cartMisses += cart.misses;
    if (!Number.isInteger(cart.hits)) t.fractionalHits++;
    if (t === on && examples.length < 3 && !Number.isInteger(cart.hits)) {
      examples.push({ visitor: id, events: events.length, cart, rows: explain(s, 'purchase', events[events.length - 1][0] + GAP + 1).map((r) => ({ signal: r.signal, hits: +r.hits.toFixed(3), misses: +r.misses.toFixed(3), effectiveWeight: +r.effectiveWeight.toFixed(3) })) });
    }
  }
}
for (const t of [off, on]) {
  console.log(`\n${t.label}: ${t.visitors} visitors, ${t.orders} orders`);
  console.log(`  mean p just before an order: ${(t.pBeforeOrder / t.orders).toFixed(4)}`);
  console.log(`  orders preceded by a reveal (threshold 0.3) within a day: ${t.revealsBeforeOrder} (${(100 * t.revealsBeforeOrder / t.orders).toFixed(1)}%), reveals in all: ${t.reveals}`);
  console.log(`  cart.added learned over all these visitors: hits ${t.cartHits.toFixed(2)}, misses ${t.cartMisses.toFixed(2)}; visitors with a fractional hit: ${t.fractionalHits}`);
  console.log(`  largest pending list: ${t.pendingMax}; serialize/deserialize round trips at episode close: ${t.roundTrips}, mismatches: ${t.errors}`);
}
console.log('\nThree returning buyers under attribution, as explain() shows them at the end:');
for (const e of examples) console.log(JSON.stringify(e));
