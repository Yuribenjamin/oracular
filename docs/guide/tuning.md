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

How much evidence it takes to move p, in the same pseudo-count units as weights. Signals of a given weight, fired together, needed to clear the default gate:

| priorStrength | weight 3 | weight 2 | weight 1 |
| ------------- | -------- | -------- | -------- |
| 5             | 3        | 5        | 9        |
| 10            | 6        | 8        | 16       |
| 20            | 9        | 14       | 27       |
| 50            | 20       | 30       | 59       |

Rule of thumb: `priorStrength` is roughly the amount of weight a session must accumulate to fire at threshold 0.5 with the default `z`, times about two. If a ready session is worth 10 to 12 pseudo-counts, `priorStrength: 5` fires on it and `priorStrength: 20` does not.

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

`threshold` is the probability you need; `z` is how sure you need to be of it. Signals of weight 3 needed:

| threshold | z    | signals |
| --------- | ---- | ------- |
| 0.3       | 1.28 | 3       |
| 0.5       | 0    | 3       |
| 0.5       | 1.28 | 6       |
| 0.5       | 1.64 | 6       |
| 0.5       | 2    | 7       |
| 0.7       | 1.28 | 12      |
| 0.9       | 1.28 | 41      |

Prefer a moderate `threshold` with the default `z` over a high threshold: raising the threshold is expensive, tightening the bound is cheap. For actions with a real cost to the user (an interruption, a discount), raise `z` to 1.64 or 2 first.

## `cooldown`

How long to stay quiet after a reveal and after the outcome. Defaults to `halfLife`. For a tip that may be shown again next week, a week; for an upgrade offer after a purchase, consider longer than the half-life; for a feature hint that should appear once, something very long with `markRevealed` as your "seen it" flag.

## `episodeTimeout`

The idle gap that ends a session on its own. 30 minutes is the usual web convention; on mobile, call `endEpisode` when the app goes to the background and keep a timeout as a safety net. Without episodes ending, nothing is ever a miss and learning cannot work.

## `learning.priorEpisodes` and `learning.gain`

`priorEpisodes` (default 10): completed episodes needed before the user's history weighs as much as your initial weight. Lower it for apps with many short sessions where you trust the data more than your guess; raise it when outcomes are rare and noisy.

`gain` (default 2): the most a signal can grow (or flip) relative to your weight. 1 means history can only shrink or flip within your scale; 3 lets a signal you underrated become a strong one.

With the default values, a signal that always precedes the outcome ends twenty sessions at 1.33× its initial weight, and one that never does ends at −0.33×. The derivation is on [Episodes & learning](/guide/concepts/episodes-and-learning).

## `learning.halfLife`

Off by default: history is permanent. Set to months if the user's habits change and old hits should stop counting.

## Try it

The [Playground](/playground) runs this exact engine. Paste a config, fire signals, move the clock and read `explain` after each click.
