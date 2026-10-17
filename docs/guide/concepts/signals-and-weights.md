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

Weights are pseudo-counts on the same scale as `priorStrength`. With the quickstart config (α₀ = 0.5, β₀ = 9.5), repeated `pricing.viewed` signals at the same instant give:

| signals | α    | β   | p     | sd    | lower (p − 1.28·sd) | fires |
| ------- | ---- | --- | ----- | ----- | ------------------- | ----- |
| 0       | 0.5  | 9.5 | 0.050 | 0.066 | 0.000               | no    |
| 1       | 3.5  | 9.5 | 0.269 | 0.119 | 0.117               | no    |
| 2       | 6.5  | 9.5 | 0.406 | 0.119 | 0.254               | no    |
| 3       | 9.5  | 9.5 | 0.500 | 0.112 | 0.357               | no    |
| 4       | 12.5 | 9.5 | 0.568 | 0.103 | 0.436               | no    |
| 5       | 15.5 | 9.5 | 0.620 | 0.095 | 0.498               | no    |
| 6       | 18.5 | 9.5 | 0.661 | 0.088 | 0.548               | yes   |

Notice that p crosses 0.5 at three signals but the lower bound only clears it at six. That gap is the point: see [Reveal & confidence](/guide/concepts/reveal-and-confidence).

## Initial versus effective weight

The weight in the config is the **initial** weight, your prior belief about how predictive the signal is. What actually gets applied is the **effective** weight: a blend of your number and what this user's history says, which starts out exactly equal to the initial weight and drifts as episodes complete. The mechanism is on the [Episodes & learning](/guide/concepts/episodes-and-learning) page; the result is visible per signal in [`explain`](/api/functions/explain) as `initialWeight`, `learnedWeight` and `effectiveWeight`.

## Contributions

The engine remembers, per signal, how much it has added to α and to β. These **contributions** decay with the intent and are what `explain` reports. They also make the state self-consistent by construction: α is always α₀ plus the sum of the signals' α-contributions, and β likewise. If you remove a signal from the config later, its contribution is dropped and α, β are recomputed; see [Persistence](/guide/persistence).

## Events that are not signals

Any event name is accepted by `observe`. Names that no intent lists as a signal or outcome change no evidence, but they still open or extend the current episode, because they are activity. `props` on an event are accepted for forward compatibility and ignored; they are never stored.

## Choosing weights

- Think in **pseudo-observations**: a weight of 3 says "seeing this is worth three observations in favour". Keep them small integers or simple fractions.
- Make the sum of signals in a typical "ready" session comfortably exceed what the threshold needs. The [Tuning guide](/guide/tuning) has the tables.
- **Negative weights** matter. A `plan.downgraded` or `cart.emptied` with a solid negative weight stops a stale positive picture from firing.
- Weights are **relative to `priorStrength`**. Doubling all weights and `priorStrength` together changes nothing about p; it only changes the confidence bound.
- An event can also be the intent's **outcome**. It is applied as a signal but never remembered for learning, so it cannot learn from itself; with the default reset on outcome its contribution is immediately cleared anyway, so listing the outcome as a signal is rarely useful.

## Reference

- [`IntentConfig.signals`](/api/interfaces/IntentConfig), [`observe`](/api/functions/observe), [`SignalContribution`](/api/interfaces/SignalContribution).
