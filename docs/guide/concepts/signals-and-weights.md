# Signals & weights

A **signal** is an event name that carries evidence about an intent. Each intent maps signal names to weights:

```ts
signals: {
  'pricing.viewed': 3,    // evidence for
  'limit.hit': 2,
  'export.clicked': 1,
  'plan.downgraded': -4,  // evidence against
}
```

## What a weight does

When [`observe`](/api/functions/observe) receives an event, every intent that lists the event name as a signal first [decays](/guide/concepts/decay) its evidence to the event's time, then applies the signal's **effective weight** `w`:

- `w > 0`: α += w (more likely)
- `w < 0`: β += |w| (less likely)

Weights are pseudo-counts on the same scale as `priorStrength`. With the quickstart config (α₀ = 0.5, β₀ = 9.5), `pricing.viewed` signals that each add their full weight of 3 (one per session, or with `saturate: false`) give, generated from the engine:

<!-- generated:full-weight-table -->
| signals | α | β | p | sd | lower (p − 1.28·sd) | fires |
| ------- | - | - | - | -- | ------------------- | ----- |
| 0 | 0.5 | 9.5 | 0.050 | 0.066 | 0.000 | no |
| 1 | 3.5 | 9.5 | 0.269 | 0.119 | 0.117 | no |
| 2 | 6.5 | 9.5 | 0.406 | 0.119 | 0.254 | no |
| 3 | 9.5 | 9.5 | 0.500 | 0.112 | 0.357 | no |
| 4 | 12.5 | 9.5 | 0.568 | 0.103 | 0.436 | no |
| 5 | 15.5 | 9.5 | 0.620 | 0.095 | 0.498 | no |
| 6 | 18.5 | 9.5 | 0.661 | 0.088 | 0.548 | yes |
<!-- /generated:full-weight-table -->

Notice that p crosses 0.5 at three signals but the lower bound only clears it at six. That gap is the point: see [Reveal & confidence](/guide/concepts/reveal-and-confidence).

## Repeats within an episode

Ten views of the pricing page in one sitting are one burst of interest, not ten pieces of evidence. Within an [episode](/guide/concepts/episodes-and-learning), the n-th occurrence of the same signal adds less than the first:

```
n-th occurrence adds   w × log2(1 + 1/n)
n occurrences add      w × log2(1 + n)
```

The first occurrence adds the whole weight and each doubling of the repeats adds one more: 1 occurrence adds `w`, 3 add `2w`, 7 add `3w`, 15 add `4w`. The same quickstart intent, `pricing.viewed` repeated in one session at one instant:

<!-- generated:saturation-table -->
| repeat | share of the weight | adds | total from `pricing.viewed` | p | lower | fires |
| ------ | ------------------- | ---- | --------------------------- | - | ----- | ----- |
| 1 | 1.000 | 3.00 | 3.00 | 0.269 | 0.117 | no |
| 2 | 0.585 | 1.75 | 4.75 | 0.356 | 0.202 | no |
| 3 | 0.415 | 1.25 | 6.00 | 0.406 | 0.254 | no |
| 4 | 0.322 | 0.97 | 6.97 | 0.440 | 0.290 | no |
| 5 | 0.263 | 0.79 | 7.75 | 0.465 | 0.318 | no |
| 6 | 0.222 | 0.67 | 8.42 | 0.484 | 0.339 | no |
| 7 | 0.193 | 0.58 | 9.00 | 0.500 | 0.357 | no |
| 8 | 0.170 | 0.51 | 9.51 | 0.513 | 0.372 | no |
| 9 | 0.152 | 0.46 | 9.97 | 0.524 | 0.385 | no |
| 10 | 0.138 | 0.41 | 10.38 | 0.534 | 0.396 | no |
| 32 | 0.044 | 0.13 | 15.13 | 0.622 | 0.501 | yes |
<!-- /generated:saturation-table -->

Six repeats add 8.42 pseudo-counts, not 18, and it takes 32 before the gate opens: one burst of a single signal is not enough for this intent. Distinct signals still add their full weight, and so does the same signal in a later session, so a "ready" pattern built from several signals or several visits fires as before.

The count is per intent and restarts when the episode ends or the intent's outcome arrives. Learning is unaffected: hits and misses are still counted once per episode, however often a signal occurred in it.

Saturation is on by default when the config sets `episodeTimeout`, and off otherwise. Without an idle timeout, episodes end only when the app calls `endEpisode`, and an app that never does would otherwise discount a signal it saw days ago. If your app ends every episode itself, set `saturate: true` on the intents that should saturate.

When the repetition itself is the evidence (the fifth undo in a row, the third failed search), set `saturate: false` on the intent and every occurrence adds its full weight, as before 0.3.

## Initial versus effective weight

The weight in the config is the **initial** weight, your prior belief about how predictive the signal is. What actually gets applied is the **effective** weight: a blend of your number and what this user's history says, which starts out exactly equal to the initial weight and drifts as episodes complete. The mechanism is on the [Episodes & learning](/guide/concepts/episodes-and-learning) page; the result is visible per signal in [`explain`](/api/functions/explain) as `initialWeight`, `learnedWeight` and `effectiveWeight`.

## Contributions

The engine remembers, per signal, how much it has added to α and to β. These **contributions** decay with the intent and are what `explain` reports. They also make the state self-consistent by construction: α is always α₀ plus the sum of the signals' α-contributions, and β likewise. If you remove a signal from the config later, its contribution is dropped and α, β are recomputed; see [Persistence](/guide/persistence).

## Events that are not signals

Any event name is accepted by `observe`. Names that no intent lists as a signal or outcome change no evidence, but they still open or extend the current episode, because they are activity. `props` on an event are accepted for forward compatibility and ignored; they are never stored.

## Choosing weights

- Think in **pseudo-observations**: a weight of 3 says "seeing this is worth three observations in favour". Keep them small integers or simple fractions.
- Make the sum of signals in a typical "ready" session comfortably exceed what the threshold needs, counting each distinct signal once: repeats add little. The [Tuning guide](/guide/tuning) has the tables.
- **Negative weights** matter. A `plan.downgraded` or `cart.emptied` with a solid negative weight stops a stale positive picture from firing.
- Weights are **relative to `priorStrength`**. Doubling all weights and `priorStrength` together changes nothing about p; it only changes the confidence bound.
- An event can also be the intent's **outcome**. It is applied as a signal but never remembered for learning, so it cannot learn from itself; with the default reset on outcome its contribution is immediately cleared anyway, so listing the outcome as a signal is rarely useful.

## Context in the name

The engine learns per event name. If the same action means different things in different places, you can put the context in the name (`'pricing.viewed'` and `'pricing.viewed.mobile'`, or `'search.empty'` and `'search.empty.onboarding'`) and give each its own weight and its own learning record.

Names are free-form strings with no meaning to the engine, dots included. If a secret scanner flags a dotted name (three segments can look like a token to a loose rule), any separator works and nothing in the engine changes.

The trade-off is sparsity: every extra name splits the user's history, so each one needs its own `priorEpisodes` worth of completed episodes before learning outweighs your guess. A signal seen in fifty sessions learns quickly; the same signal split ten ways learns ten times more slowly, and some buckets never fill. Recommendation: at most two or three buckets per action, chosen along the one distinction that changes what the action means (surface, or funnel stage, not both). Everything else belongs in `props`, which the engine ignores and never stores, and in your own analytics.

## Reference

- [`IntentConfig.signals`](/api/interfaces/IntentConfig), [`observe`](/api/functions/observe), [`SignalContribution`](/api/interfaces/SignalContribution).
