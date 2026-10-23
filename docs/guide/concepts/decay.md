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

`at` is a timestamp and every duration is in the same unit. The engine keeps a clock: the latest event time it trusts. An event at or after it moves the clock there and decays from the anchors as usual. An event stamped *behind* the clock (a device clock adjusted, an event arriving out of order) applies no decay, counts now at the clock's time, and holds its stamp for the next event to judge. Nothing throws and nothing becomes negative.

The next event decides what the held stamp was. If it is also behind the clock, the clock was corrected: every anchor ahead of the held stamp (evidence, learned counts, reveals, outcomes, the open episode, the episodes waiting under `attribution`) moves back to it, and decay and cooldowns resume from the corrected time. If it is at or after the clock, the held stamp was one glitch, and nothing moved: the evidence was not decayed across the gap and the session was not closed by it. One event stamped years ahead therefore adds its evidence and freezes decay for at most the two events that follow it; one stamped years behind changes nothing but its own evidence. Reads before an anchor see the evidence held. A reveal or an outcome stamped ahead of the clock counts as having happened now: its cooldown ends one `cooldown` after the current time, and the next event pins it to its own time. Learned counts under `learning.halfLife` follow the same clock.

Two costs come with the rule. The first event after a correction is processed at the uncorrected time, so the intents it touches are decayed to that time and their episodes waiting under `attribution` can settle as misses before the second event moves everything back. And two bad stamps in a row read as a correction, which costs what 0.10 paid on every backward step: the anchors move to the bad time and the next good event decays the gap again. One case no rule covers: a device that boots in 1970 and syncs forward later makes a single monotone jump of decades, indistinguishable from a long absence, so the evidence decays away and the session closes. Hold `observe` until the device clock is trusted, as an analytics SDK would.

`settleState(state, at)` also advances the engine clock, without recording an event or extending
a session. It closes expired sessions, settles attribution windows, and decays every intent.
An `at` earlier than the current engine clock holds there; it does not confirm a backwards clock
correction. Supply trusted time: settlement cannot tell a long absence from a bad future stamp.

The React store's default clock uses a monotonic timer while running, anchored to saved history.
On restoration, it estimates the absence from the device-clock sample taken at store creation.
It accepts only a nonnegative gap up to `maxResumeGap` (30 days by default). Otherwise it anchors
to the latest saved clock/evidence/learning/pending-close time and reports `getClockStatus() ===
'held'`; the steady timer advances from there, ignoring the guessed absence. Queued store-stamped
operations keep their elapsed spacing after reanchoring. This is a configurable heuristic, not
a way to verify the real date: an incorrect clock within the bound is indistinguishable from a
real absence, and real absences beyond it are held too. `now` is an explicit trusted override;
`monotonicNow` supplies a platform timer. No internet request is made. A missing or invalid
monotonic timer holds time; OS suspension follows the platform timer's behavior.

React startup settlement is opt-in (`settleOnLoad: true`), skipped when the clock is held, and
saved through the normal debounce. Loading alone does not force a write or wait for it.

## Learned data decays separately

Hit and miss counts, and the episode counts, are not evidence about *now*; they are knowledge about *this user*. They do not decay unless you set `learning.halfLife`, which gives them their own, usually much longer, half-life. See [Episodes & learning](/guide/concepts/episodes-and-learning).

## Reference

- [`IntentConfig.halfLife`](/api/interfaces/IntentConfig), [`LearningConfig.halfLife`](/api/interfaces/LearningConfig), [`IntentState.updatedAt`](/api/interfaces/IntentState).
