# Episodes & learning

The weights you write in the config are guesses. oracular corrects them with the only data that is both relevant and available on the device: whether, for *this* user, a signal tends to be followed by the intent's outcome.

## Episodes

An **episode** is a session. Any event opens one if none is open and extends it otherwise. An episode ends when:

- your app calls [`endEpisode`](/api/functions/endEpisode) (tab closed, app backgrounded, user signed out), or
- `config.episodeTimeout` is set and the next event arrives after a longer idle gap. The old episode is then closed at the moment it timed out, before the new event is applied.

One episode is open at a time, shared by all intents. Within it, every intent remembers which of its signals it has **seen**.

## Hits and misses

Each intent may name an `outcome` event, the thing it predicts:

```ts
upgrade: { signals: { 'pricing.viewed': 3, 'limit.hit': 2 }, outcome: 'upgrade.completed', /* … */ }
```

- When the outcome arrives, every signal seen in the episode gets a **hit**, the intent counts one episode *with* the outcome toward its **base rate**, the seen list is cleared and the intent is marked resolved for this episode. By default the intent's evidence is also reset; see [Outcomes & cooldowns](/guide/concepts/outcomes-and-cooldowns).
- When the episode ends without the outcome, every seen signal gets a **miss** and the intent counts one episode *without* the outcome. Episodes in which the intent saw no signal at all still count toward the base rate, because they are sessions in which the outcome did not happen.
- Signals seen *after* an outcome in the same episode are neutral at episode end: they get a hit if a second outcome arrives, nothing otherwise.

An outcome event that no episode preceded still counts toward the base rate. An event that is both a signal and the outcome of the same intent is never remembered as seen, so it cannot learn from itself.

## From hits and misses to a weight

For a signal with initial weight `w₀`, `hits` and `misses`:

```
n         = hits + misses
q         = (hits + 1) / (n + 2)                        Laplace-smoothed hit rate
b         = (outcomes + 1) / (episodes + 2)             Laplace-smoothed base rate
lift      = (q − b) / (1 − b)   if q ≥ b
          = (q − b) / b         otherwise                → in [−1, 1]
learned   = gain × |w₀| × lift                          0 while n = 0
effective = (k × w₀ + n × learned) / (k + n)            k = learning.priorEpisodes
```

Two knobs, both under `config.learning`:

- **`gain`** (default 2) caps how far a perfectly predictive signal can grow: `learned` lives in [−gain·|w₀|, gain·|w₀|].
- **`priorEpisodes`** (default 10) is how many completed episodes it takes for the user's history to weigh as much as your initial weight. The signal's strength (`w₀`) and your confidence in it (`k`) are deliberately separate things.

## Why the base rate matters

`lift` compares the signal's hit rate with the intent's own base rate, not with 50%. For an outcome that happens in 3% of sessions, a signal followed by it 30% of the time is strong evidence; centered on 50% it would wrongly learn as negative. Conversely, a signal present in every session of a user who upgrades 70% of the time carries no information, and its weight correctly drifts toward zero.

## Worked example

Twenty sessions. In ten, signal `A` (weight 1) is seen and the outcome follows. In the other ten, signal `B` (weight 1) is seen and nothing follows.

```
A: hits 10, misses 0     q_A = 11/12 = 0.917
B: hits 0,  misses 10    q_B = 1/12  = 0.083
base rate: 10 of 20      b   = 11/22 = 0.5

lift_A = (0.917 − 0.5) / 0.5 = +0.833    learned_A = 2 × 1 × 0.833 = +1.67
lift_B = (0.083 − 0.5) / 0.5 = −0.833    learned_B = −1.67

effective_A = (10 × 1 + 10 × 1.67) / 20 = +1.33
effective_B = (10 × 1 − 10 × 1.67) / 20 = −0.33
```

After twenty sessions, `A` counts a third more than you said and `B` has flipped to weak evidence *against*. With `priorEpisodes: 2` the same history gives `A` 1.56; with `50` it gives 1.11. These numbers are pinned by the test suite.

## Forgetting

By default learned counts never decay: what the user did six months ago still counts as much as yesterday. Set `learning.halfLife` to let old hits and misses fade, typically with a half-life of months rather than days.

## What you have to do

Two things, and the first is the one people forget:

1. **End episodes.** Without `endEpisode` or `episodeTimeout`, nothing ever gets a miss, every seen signal looks perfectly predictive, and the base rate climbs to 100%. Call `endEpisode` when the session ends, and set `episodeTimeout` as a safety net.
2. **Emit the outcome event** with the exact name in `outcome`.

## Reference

- [`endEpisode`](/api/functions/endEpisode), [`EngineConfig.episodeTimeout`](/api/interfaces/EngineConfig), [`LearningConfig`](/api/interfaces/LearningConfig), [`SignalRecord`](/api/interfaces/SignalRecord), [`EpisodeState`](/api/interfaces/EpisodeState).
