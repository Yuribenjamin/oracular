# Tuning guide

Every number in a config means something concrete. This page says what, and gives you tables to pick from. All numbers below are computed from the library with the quickstart config unless stated otherwise:

```ts
upgrade: {
  prior: 0.05, priorStrength: 10, halfLife: 7 days,
  signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
  outcome: 'upgrade.completed',
}
// threshold 0.5, z 1.28, cooldown = halfLife
```

## A procedure

1. Set `prior` to the fraction of sessions (or users) that actually do the thing. Guess if you have to; it is a prior.
2. Start with `priorStrength: 10`, weights between 1 and 3 for positive signals and −2 to −4 for strong negatives, `halfLife` at the horizon over which the behaviour builds, and the default `threshold`/`z`.
3. Decide how a "ready" session looks: which signals, how many, over how long. Check with the tables below that it fires, and that a lukewarm session doesn't.
4. Replay a few real event sequences in development and read [`explain`](/guide/explainability). Adjust weights, not thresholds, when one signal dominates for the wrong reason.
5. Ship. Learning takes over per user from there; `priorEpisodes` decides how fast.

## `prior`

Where p starts and where it returns. Use the observed base rate. Too high and the gate opens on weak evidence; too low and the signals have to fight the prior. The learning base rate is tracked separately and does not depend on this value.

## `priorStrength`

How much evidence it takes to move p, in the same pseudo-count units as weights. The evidence the quickstart config needs to clear the default gate, and how many signals of a given weight, fired together, that is. Generated from [`evidenceToReveal`](/api/functions/evidenceToReveal) and checked by the test suite, so the table and the library cannot disagree:

<!-- generated:priorStrength-table -->
| priorStrength | evidence needed | weight 3 | weight 2 | weight 1 |
| ------------- | --------------- | -------- | -------- | -------- |
| 5 | 8.9 | 3 | 5 | 9 |
| 10 | 15.1 | 6 | 8 | 16 |
| 20 | 26.5 | 9 | 14 | 27 |
| 50 | 58.2 | 20 | 30 | 59 |
<!-- /generated:priorStrength-table -->

Rule of thumb for the default gate (threshold 0.5, z 1.28):

```
evidence needed ≈ (1 − 2·prior) × priorStrength + 1.9 × √priorStrength
```

The first term is what it takes to pull p to 0.5 (α must catch up with β); the second is the confidence margin, which grows only with the square root of the strength. For the quickstart (prior 0.05): priorStrength 5 → about 9, 10 → about 15, 20 → about 26, 50 → about 58. Read it the other way to choose: if a convincing session is worth 10 to 12 pseudo-counts, `priorStrength: 5` fires on it (needs 8.9) and `priorStrength: 10` does not (needs 15.1). For an exact number with your own threshold and z, call `evidenceToReveal(intentConfig)`.

## `halfLife`

How long evidence keeps mattering. Evidence decays toward the prior by half every `halfLife`:

| time since 6 × `pricing.viewed` | p     | lower |
| ------------------------------- | ----- | ----- |
| now                             | 0.661 | 0.548 |
| 1 day                           | 0.639 | 0.521 |
| 1 week                          | 0.500 | 0.357 |
| 2 weeks                         | 0.345 | 0.190 |
| 4 weeks                         | 0.146 | 0.016 |

The half-life also sets a **ceiling** on evidence that arrives regularly: a weight `w` every `τ` settles at about `w / (1 − 2^(−τ/halfLife))`. The same six-signal threshold looks very different depending on pacing:

| `pricing.viewed` pacing (half-life 1 week) | fires after |
| ------------------------------------------ | ----------- |
| all at once                                | 6 signals   |
| one per day                                | 7 signals   |
| one every 3 days                           | never       |
| one per week                               | never       |

If a behaviour builds over weeks, give it a half-life of weeks. If it is a state of the current session (stuck, exploring), use minutes and let it vanish. The cooldown defaults to the half-life too, so a long half-life also means a long pause after each reveal unless you set `cooldown`.

## Weights

Weights are pseudo-observations. Make a convincing session sum to about `priorStrength` or more; make a single ambiguous event a fraction of it. Use negative weights for events that contradict the intent. Don't encode frequency in the weight: a signal that fires ten times adds its weight ten times already.

Remember that your weights are **priors** for the learner. After `priorEpisodes` completed episodes the user's own history counts as much as you do, and a perfectly predictive signal can grow to `gain × |weight|`; see below.

## `threshold` and `z`

`threshold` is the probability you need; `z` is how sure you need to be of it. For the quickstart config, the evidence each gate needs and how many signals of weight 3 that is (generated, like the table above):

<!-- generated:threshold-z-table -->
| threshold | z | evidence needed | signals of weight 3 |
| --------- | ---- | --------------- | ------------------- |
| 0.3 | 1.28 | 7.2 | 3 |
| 0.5 | 0 | 9.0 | 3 |
| 0.5 | 1.28 | 15.1 | 6 |
| 0.5 | 1.64 | 17.0 | 6 |
| 0.5 | 2 | 18.9 | 7 |
| 0.7 | 1.28 | 33.1 | 12 |
| 0.9 | 1.28 | 122.9 | 41 |
<!-- /generated:threshold-z-table -->

Prefer a moderate `threshold` with the default `z` over a high threshold: raising the threshold is expensive, tightening the bound is cheap. For actions with a real cost to the user (an interruption, a discount), raise `z` to 1.64 or 2 first.

## `cooldown`

How long to stay quiet after a reveal and after the outcome. Defaults to `halfLife`. For a tip that may be shown again next week, a week; for an upgrade offer after a purchase, consider longer than the half-life; for a feature hint that should appear once, something very long with `markRevealed` as your "seen it" flag.

## `episodeTimeout`

The idle gap that ends a session on its own. 30 minutes is the usual web convention; on mobile, call `endEpisode` when the app goes to the background and keep a timeout as a safety net. Without episodes ending, nothing is ever a miss and learning cannot work.

## `learning.priorEpisodes` and `learning.gain`

`priorEpisodes` (default 10): completed episodes needed before the user's history weighs as much as your initial weight. Lower it for apps with many short sessions where you trust the data more than your guess; raise it when outcomes are rare and noisy.

It also sets the size of the early-episode dip described on [Episodes & learning](/guide/concepts/episodes-and-learning#early-episode-learning): after the first confirmed episode a signal sits at `(k + 2/3) / (k + 1)` of its initial weight (0.97× at 10, 0.94× at 5, 0.98× at 20) until there are sessions without it to compare against. If the first few sessions of a new user matter to you, keep `priorEpisodes` at 10 or above.

`gain` (default 2): the most a signal can grow (or flip) relative to your weight. 1 means history can only shrink or flip within your scale; 3 lets a signal you underrated become a strong one.

With the default values, a signal that always precedes the outcome ends twenty sessions at 1.33× its initial weight, and one that never does ends at −0.33×. The derivation is on [Episodes & learning](/guide/concepts/episodes-and-learning).

## `learning.halfLife`

Off by default: history is permanent. Set to months if the user's habits change and old hits should stop counting.

## Two worked examples

### Days: the upgrade offer

The quickstart config. Evidence needed: 15.1 pseudo-counts. Six `pricing.viewed` at once fire it; one a day fires on the seventh; one every three days never does, because a one-week half-life removes evidence about as fast as that pace adds it. The outcome `upgrade.completed` resets the slate and pauses offers for the cooldown, a week by default. Everything on this page so far is this example.

### Hours: about to ride

A transit app wants to surface the ticket wallet or the live platform view when a rider is about to board. The behaviour builds over minutes and is stale by lunchtime, so every duration is hours:

```ts
ride: {
  prior: 0.1,
  priorStrength: 8,
  halfLife: 3 * HOUR,
  signals: {
    'app.opened': 1,
    'departures.viewed': 2,
    'route.planned': 3,
    'ticket.bought': 4,
    'trip.cancelled': -3,
  },
  outcome: 'ride.started',
  reveal: { cooldown: 4 * HOUR },
}
// with config.episodeTimeout: 30 * MINUTE
```

`evidenceToReveal(ride)` is 11.7. A typical morning:

| time  | event              | p     | lower | fires |
| ----- | ------------------ | ----- | ----- | ----- |
| 07:00 | app.opened         | 0.200 | 0.038 | no    |
| 07:02 | departures.viewed  | 0.345 | 0.169 | no    |
| 07:03 | route.planned      | 0.485 | 0.320 | no    |
| 07:06 | ticket.bought      | 0.598 | 0.454 | no    |
| 07:08 | departures.viewed  | 0.640 | 0.506 | yes   |

Ten pseudo-counts put p at 0.6 but leave the lower bound under 0.5; the second look at departures (+2, total 12) opens the gate. Then the clock does its work: with a three-hour half-life, the same state read at 10:06 is back to p 0.44, and at 19:06 to 0.31. The evening commute has to earn its own reveal, which is what you want.

When `ride.started` arrives at 07:16 (an ordinary `observe` call with that name), the evidence resets to the prior (p 0.1), the seen signals get their hit, and `suppressedUntil` is set to 11:16: the four-hour cooldown keeps the wallet from popping up again on the way to the office. A 30-minute `episodeTimeout` means the morning and evening trips are separate episodes, so an evening with no ride gives the evening's signals a miss rather than crediting them to the morning.

The pattern to copy: half-life at the horizon over which the behaviour builds, cooldown a bit longer than the behaviour's own cycle, episode timeout at the natural session gap. Then check with `evidenceToReveal` that a typical ready sequence clears it and a casual one does not.

## Try it

The [Playground](/playground) runs this exact engine. Paste a config, fire signals, move the clock and read `explain` after each click.
