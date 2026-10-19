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

If you already have a [shadow log](/guide/shadow-mode), `npx oracular tune` does steps 1, 2 and the weights from data and prints the config to paste; the steps below are what it does, by hand, and how to read what it printed.

1. Set `prior` to the fraction of sessions (or users) that actually do the thing. Guess if you have to; it is a prior.
2. Start with `priorStrength: 10`, weights between 1 and 3 for positive signals and −2 to −4 for strong negatives, `halfLife` at the horizon over which the behaviour builds, and the default `threshold`/`z`.
3. Decide how a "ready" session looks: which signals, how many, over how long. Count each distinct signal once per session (repeats add little). Check with the tables below that it fires, and that a lukewarm session doesn't.
4. Replay a few real event sequences in development and read [`explain`](/guide/explainability). Adjust weights, not thresholds, when one signal dominates for the wrong reason.
5. Ship. Learning takes over per user from there; `priorEpisodes` decides how fast.

## `prior`

Where p starts and where it returns. Use the observed base rate. Too high and the gate opens on weak evidence; too low and the signals have to fight the prior. The learning base rate is tracked separately and does not depend on this value.

## `priorStrength`

How much evidence it takes to move p, in the same pseudo-count units as weights. The evidence the quickstart config needs to clear the default gate; how many full-weight signals of a given weight that is (distinct signals, or one per session); and how many times one weight-3 signal would have to repeat within a single session, where [repeats count for less](#repeated-signals). Generated from [`evidenceToReveal`](/api/functions/evidenceToReveal) and checked by the test suite, so the table and the library cannot disagree:

<!-- generated:priorStrength-table -->
| priorStrength | evidence needed | weight 3 | weight 2 | weight 1 | one weight-3 signal repeated in one session |
| ------------- | --------------- | -------- | -------- | -------- | ------------------------------------------- |
| 5 | 8.9 | 3 | 5 | 9 | 7 |
| 10 | 15.1 | 6 | 8 | 16 | 32 |
| 20 | 26.5 | 9 | 14 | 27 | 455 |
| 50 | 58.2 | 20 | 30 | 59 | more than 10,000 |
<!-- /generated:priorStrength-table -->

Rule of thumb for the default gate (threshold 0.5, z 1.28):

```
evidence needed ≈ (1 − 2·prior) × priorStrength + 1.9 × √priorStrength
```

The first term is what it takes to pull p to 0.5 (α must catch up with β); the second is the confidence margin, which grows only with the square root of the strength. For the quickstart (prior 0.05): priorStrength 5 → about 9, 10 → about 15, 20 → about 26, 50 → about 58. Read it the other way to choose: if a convincing session is worth 10 to 12 pseudo-counts, `priorStrength: 5` fires on it (needs 8.9) and `priorStrength: 10` does not (needs 15.1). For an exact number with your own threshold and z, call `evidenceToReveal(intentConfig)`; it follows `bound: 'exact'` too, which asks for a little more at small strengths.

## `halfLife`

How long evidence keeps mattering. Evidence decays toward the prior by half every `halfLife`:

| time since 6 full-weight `pricing.viewed` | p     | lower |
| ------------------------------- | ----- | ----- |
| now                             | 0.661 | 0.548 |
| 1 day                           | 0.639 | 0.521 |
| 1 week                          | 0.500 | 0.357 |
| 2 weeks                         | 0.345 | 0.190 |
| 4 weeks                         | 0.146 | 0.016 |

The half-life also sets a **ceiling** on evidence that arrives regularly: a weight `w` every `τ` settles at about `w / (1 − 2^(−τ/halfLife))`. The same six-signal threshold looks very different depending on pacing:

<!-- generated:pacing-table -->
| `pricing.viewed` pacing (half-life 1 week, sessions end after 30 idle minutes) | fires after |
| ------------------------------------------------------------------------------ | ----------- |
| all in one session | 32 signals |
| one per session, an hour apart | 6 signals |
| one per day | 7 signals |
| one every 3 days | never |
| one per week | never |
<!-- /generated:pacing-table -->

If a behaviour builds over weeks, give it a half-life of weeks. If it is a state of the current session (stuck, exploring), use minutes and let it vanish. The cooldown defaults to the half-life too, so a long half-life also means a long pause after each reveal unless you set `cooldown`.

## Weights

Weights are pseudo-observations. Make a convincing session sum to about `priorStrength` or more, counting each distinct signal once; make a single ambiguous event a fraction of it. Use negative weights for events that contradict the intent. Don't encode frequency in the weight: frequency across sessions is already in the evidence, since every session's occurrence counts in full, and frequency within a session is deliberately discounted (see below).

Remember that your weights are **priors** for the learner. After `priorEpisodes` completed episodes the user's own history counts as much as you do, and a perfectly predictive signal can grow to `gain × |weight|`; see below.

## Repeated signals

Within one episode, the n-th occurrence of a signal adds `w × log2(1 + 1/n)`, so n occurrences add `w × log2(1 + n)`: 1, 1.58, 2, 2.32 … 3.46 weights for 1 to 10 occurrences. The [Signals & weights](/guide/concepts/signals-and-weights#repeats-within-an-episode) page has the table. For the quickstart that means one burst of `pricing.viewed` cannot open the gate (it takes 32 in one session); several distinct signals, or the same signal across sessions, can.

Two things follow for tuning:

- **Episodes must end.** The count restarts with each episode, so saturation is on by default only when the config sets `episodeTimeout`. An app that ends episodes with `endEpisode` alone can set `saturate: true`; one that never ends them keeps full weights rather than discounting a signal it saw yesterday. Set `episodeTimeout`; learning needs it anyway.
- **Opt out where repetition is the evidence.** For a "stuck" intent, the fifth undo in a row says more than the first. Set `saturate: false` on that intent and every occurrence adds its full weight, as before 0.3.

## `threshold` and `z`

`threshold` is the probability you need; `z` is how sure you need to be of it. For the quickstart config, the evidence each gate needs and how many full-weight signals of weight 3 that is (generated, like the table above):

<!-- generated:threshold-z-table -->
| threshold | z | evidence needed | full-weight signals of weight 3 |
| --------- | ---- | --------------- | ------------------------------- |
| 0.3 | 1.28 | 7.2 | 3 |
| 0.5 | 0 | 9.0 | 3 |
| 0.5 | 1.28 | 15.1 | 6 |
| 0.5 | 1.64 | 17.0 | 6 |
| 0.5 | 2 | 18.9 | 7 |
| 0.7 | 1.28 | 33.1 | 12 |
| 0.9 | 1.28 | 122.9 | 41 |
<!-- /generated:threshold-z-table -->

Prefer a moderate `threshold` with the default `z` over a high threshold: raising the threshold is expensive, tightening the bound is cheap. For actions with a real cost to the user (an interruption, a discount), raise `z` to 1.64 or 2 first.

One diagnostic: if raising the threshold costs recall and buys no precision, the config has effectively one signal and the gate has become a counter. p then moves only with how often that signal has happened, so a higher threshold only asks for more of it. On the returning visitors of the [clickstream case study](/guide/case-study-clickstream#the-rule-a-skeptic-would-write), moving the printed config from 0.3 to 0.4 takes precision from 38.0% to 37.9% and recall from 12.0% to 4.5%. The fixes are more signals, or faster learning (`learning.priorEpisodes` and `learning.gain`), not a higher threshold.

## `cooldown`

How long to stay quiet after a reveal and after the outcome. Defaults to `halfLife`. For a tip that may be shown again next week, a week; for an upgrade offer after a purchase, consider longer than the half-life; for a feature hint that should appear once, something very long with `markRevealed` as your "seen it" flag.

## `episodeTimeout`

The idle gap that ends a session on its own. 30 minutes is the usual web convention. Set it everywhere and let it do the work; calling `endEpisode` on `pagehide` or when the app goes to the background would split sessions. Without episodes ending, nothing is ever a miss and learning cannot work.

## `attribution`

Off by default. How long a session's signals wait for the outcome after the session ends, in the unit of `at`. Set it for intents that build over days: the Monday pricing visit then earns a share of Tuesday's upgrade instead of a miss, the share being what its evidence is still worth on Tuesday, `2^(−age / halfLife)` ([Episodes & learning](/guide/concepts/episodes-and-learning#credit-across-episodes)). Start at the intent's `halfLife`: inside that window every share is at least one half, and a session older than that would add little to p anyway. Leave it unset for intents measured in minutes or one session; a session that ends without the outcome is then rightly a miss. The state holds at most 32 waiting sessions per intent.

## `learning.priorEpisodes` and `learning.gain`

`priorEpisodes` (default 10): how much contrast it takes before the user's history weighs as much as your initial weight. Contrast is counted as `nEff = (sessions with the signal × sessions without) / (both)`, so ten sessions on each side count as five. Lower `priorEpisodes` for apps with many short sessions where you trust the data more than your guess; raise it when outcomes are rare and noisy.

There is no early dip: a weight does not move until the signal has been both present and absent, and the first confirmed session leaves it exactly where you set it. See [Episodes & learning](/guide/concepts/episodes-and-learning#early-episode-learning) for the numbers.

`gain` (default 2): the most a signal can grow (or flip) relative to your weight. 1 means history can only shrink or flip within your scale; 3 lets a signal you underrated become a strong one.

With the default values, a signal that always precedes the outcome ends twenty sessions at 1.33× its initial weight, and one that never does ends at −0.33×. The derivation is on [Episodes & learning](/guide/concepts/episodes-and-learning).

## `learning.halfLife`

Off by default: history is permanent. Set to months if the user's habits change and old hits should stop counting.

## Two worked examples

### Days: the upgrade offer

The quickstart config. Evidence needed: 15.1 pseudo-counts. Six `pricing.viewed` in six sessions fire it; one a day fires on the seventh; one every three days never does, because a one-week half-life removes evidence about as fast as that pace adds it; and 32 in a single session are needed, because repeats within a session count for less. The outcome `upgrade.completed` resets the slate and pauses offers for the cooldown, a week by default. Everything on this page so far is this example.

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

<!-- generated:ride-table -->
| time | event | p | lower | fires |
| ---- | ----- | - | ----- | ----- |
| 07:00 | app.opened | 0.200 | 0.038 | no |
| 07:02 | departures.viewed | 0.345 | 0.169 | no |
| 07:03 | route.planned | 0.485 | 0.320 | no |
| 07:06 | ticket.bought | 0.598 | 0.454 | no |
| 07:08 | departures.viewed | 0.621 | 0.482 | no |
| 07:09 | route.planned | 0.652 | 0.522 | yes |
| 10:09 | (no event, read only) | 0.499 | 0.335 | no |
| 19:09 | (no event, read only) | 0.181 | 0.024 | no |
<!-- /generated:ride-table -->

Ten pseudo-counts put p at 0.6 but leave the lower bound under 0.5. The second look at departures is a repeat within the session, so it adds 1.17 rather than 2 and the bound stays just short; the second route check adds 1.75 more and opens the gate at 07:09. Then the clock does its work: with a three-hour half-life, the same state read three hours later is back to p 0.50, and twelve hours later to 0.18. The evening commute has to earn its own reveal, which is what you want.

When `ride.started` arrives at 07:16 (an ordinary `observe` call with that name), the evidence resets to the prior (p 0.1), the seen signals get their hit, and `suppressedUntil` is set to 11:16: the four-hour cooldown keeps the wallet from popping up again on the way to the office. A 30-minute `episodeTimeout` means the morning and evening trips are separate episodes, so an evening with no ride gives the evening's signals a miss rather than crediting them to the morning.

The pattern to copy: half-life at the horizon over which the behaviour builds, cooldown a bit longer than the behaviour's own cycle, episode timeout at the natural session gap. Then check with `evidenceToReveal` that a typical ready sequence clears it and a casual one does not.

## Try it

The [Playground](/playground) runs this exact engine. Paste a config, fire signals, move the clock and read `explain` after each click.
