# Decay

Evidence is only as good as it is recent. Someone who looked at pricing a month ago is not someone who looked at pricing today. oracular models that with exponential decay governed by each intent's `halfLife`.

## The rule

Before any update or reading, the intent's evidence is decayed to the current time. With Δt the time since the intent was last updated:

```
d  = 2^(−Δt / halfLife)
α  = α₀ + (α − α₀) · d
β  = β₀ + (β − β₀) · d
```

Each per-signal contribution is scaled by the same `d`. Only the **excess over the prior** decays, so with no events p returns to `prior` and evidence (α + β) returns to `priorStrength`, never to zero.

After six full-weight `pricing.viewed` signals in the quickstart config (α = 18.5, β = 9.5, half-life one week):

| time since | p     | lower | evidence |
| ---------- | ----- | ----- | -------- |
| now        | 0.661 | 0.548 | 28.0     |
| 1 day      | 0.639 | 0.521 | 26.3     |
| 1 week     | 0.500 | 0.357 | 19.0     |
| 2 weeks    | 0.345 | 0.190 | 14.5     |
| 4 weeks    | 0.146 | 0.016 | 11.1     |
| 8 weeks    | 0.057 | 0.000 | 10.1     |

## Decay is lazy

Decay is applied when an intent is touched: by `observe` for an event that is one of its signals or its outcome, and, without storing anything, by `predict`, `shouldReveal` and `explain` for the reading. An intent that nothing has touched for a month keeps its old numbers in the state and its old `updatedAt`; the next touch applies a month of decay in one step. The result is identical to decaying continuously, and the state stays cheap to update.

## Evidence has a ceiling

Because evidence decays while it accumulates, a signal that arrives regularly settles at a steady level rather than growing forever. A weight `w` arriving every `τ` contributes at most about

```
w / (1 − 2^(−τ / halfLife))
```

in the long run. With the quickstart config, one `pricing.viewed` (+3) every three days with a one-week half-life settles near α ≈ 12, p ≈ 0.56, lower ≈ 0.44: **it never fires** at the default threshold. The same signal daily fires after seven (each day is a new session, so each adds its full weight), while repeating it within one session [adds less each time](/guide/concepts/signals-and-weights#repeats-within-an-episode). Half-life, weights and threshold have to be chosen together; the [Tuning guide](/guide/tuning) walks through it.

## Choosing a half-life

Ask how long a signal should keep mattering:

- *Stuck in onboarding*: minutes. Being stuck is a state of the current session.
- *Ready to upgrade*: a week or two. Pricing viewed last Tuesday still counts.
- *About to churn*: weeks. Churn builds slowly.

## Clocks

`at` is a timestamp and every duration is in the same unit. If a clock goes backwards (a device clock adjustment, events arriving out of order), the engine applies no decay and does not move its anchor back. Nothing throws and nothing becomes negative.

## Learned data decays separately

Hit and miss counts, and the episode counts, are not evidence about *now*; they are knowledge about *this user*. They do not decay unless you set `learning.halfLife`, which gives them their own, usually much longer, half-life. See [Episodes & learning](/guide/concepts/episodes-and-learning).

## Reference

- [`IntentConfig.halfLife`](/api/interfaces/IntentConfig), [`LearningConfig.halfLife`](/api/interfaces/LearningConfig), [`IntentState.updatedAt`](/api/interfaces/IntentState).
