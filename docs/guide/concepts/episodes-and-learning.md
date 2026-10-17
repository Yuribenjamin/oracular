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

For a signal with initial weight `w₀`, `hits` and `misses`, inside an intent that has seen `episodes` episodes of which `outcomes` ended with the outcome:

```
n         = hits + misses                                       episodes in which the signal was seen
qWith     = (hits + 1) / (n + 2)                                outcome rate of those episodes
qWithout  = (outcomes − hits + 1) / (episodes − n + 2)          outcome rate of the other episodes
lift      = (qWith − qWithout) / (1 − qWithout)   if qWith ≥ qWithout
          = (qWith − qWithout) / qWithout         otherwise      → in [−1, 1]
learned   = gain × |w₀| × lift                                  0 while n = 0
effective = (k × w₀ + n × learned) / (k + n)                    k = learning.priorEpisodes
```

Both rates are Laplace-smoothed (+1 / +2). Two knobs, both under `config.learning`:

- **`gain`** (default 2) caps how far a perfectly predictive signal can grow: `learned` lives in [−gain·|w₀|, gain·|w₀|].
- **`priorEpisodes`** (default 10) is how many completed episodes it takes for the user's history to weigh as much as your initial weight. The signal's strength (`w₀`) and your confidence in it (`k`) are deliberately separate things.

## Why the contrast matters

`lift` compares the outcome rate of the sessions in which the signal appeared with the outcome rate of the sessions in which it did not. That is the question a signal has to answer: does the outcome happen more often when you are present? For an outcome that happens in 3% of sessions, a signal followed by it 30% of the time is strong evidence; compared against 50% it would wrongly learn as negative, and compared against the overall base rate (which includes its own sessions) it would be judged partly against itself.

## Worked example

Twenty sessions. In ten, signal `A` (weight 1) is seen and the outcome follows. In the other ten, signal `B` (weight 1) is seen and nothing follows.

```
A: hits 10, misses 0     qWith_A    = 11/12 = 0.917
   other 10 sessions, 0 outcomes      qWithout_A = 1/12  = 0.083
B: hits 0,  misses 10    qWith_B    = 1/12  = 0.083
   other 10 sessions, 10 outcomes     qWithout_B = 11/12 = 0.917

lift_A = (0.917 − 0.083) / (1 − 0.083) = +0.909    learned_A = 2 × 1 × 0.909 = +1.82
lift_B = (0.083 − 0.917) / 0.917       = −0.909    learned_B = −1.82

effective_A = (10 × 1 + 10 × 1.82) / 20 = +1.41
effective_B = (10 × 1 − 10 × 1.82) / 20 = −0.41
```

After twenty sessions, `A` counts 41% more than you said and `B` has flipped to evidence *against*. With `priorEpisodes: 2` the same history gives `A` 1.68; with `50` it gives 1.14. These numbers are pinned by the test suite.

## Early-episode learning

The first confirmed episode moves a signal's weight slightly, and it is worth understanding why. After one episode in which `A` was seen and the outcome followed, `A` has one hit and no misses, so `qWith = (1 + 1) / (1 + 2) = 2/3`. There are no other episodes yet, so `qWithout` is the smoothed rate of an empty set, `1/2`. The lift is `(2/3 − 1/2) / (1/2) = 1/3`, `learned` is `2/3 × w₀`, and the blend becomes

```
effective = (k × w₀ + 1 × 2/3 × w₀) / (k + 1) = w₀ × (k + 2/3) / (k + 1)
```

With `priorEpisodes` at its default of 10 that is 0.97 × w₀; with 5 it is 0.94 × w₀; with 20 it is 0.98 × w₀. A small dip, governed by `priorEpisodes`, that turns into a rise as soon as there are sessions without the signal where the outcome did not happen: after one confirmed episode and five such sessions, `A` sits above its initial weight.

The dip exists because one observation cannot clear the Laplace smoothing on its own: with a single hit the lift is 1/3, and the blend treats a learned weight below `w₀` as a reason to shrink. A confirmed first episode never pushes a weight below `(k + 2/3) / (k + 1)` of its initial value.

## Signals present in every episode

A signal that appears in every session of an intent has no sessions without it to be compared against. `qWithout` is then the smoothed rate of an empty set, `1/2`, and the signal is judged against 50% rather than against this user's actual behaviour: for an intent whose outcome happens in most sessions it reads as positive, for a rare outcome as negative, in both cases without having told you anything. Keep this in mind for signals like `app.opened` that fire in every session; give them a small weight, or none, and let the discriminating signals carry the intent.

## Forgetting

By default learned counts never decay: what the user did six months ago still counts as much as yesterday. Set `learning.halfLife` to let old hits and misses fade, typically with a half-life of months rather than days.

## Detecting an episode close

An episode closed between two states when the previous one had an episode open and the next one has a different one (or none):

```ts
prev.episode.startedAt !== null && next.episode.startedAt !== prev.episode.startedAt
```

[`episodeClosed(prev, next)`](/api/functions/episodeClosed) is that rule as a function. It is true across `endEpisode`, and across an `observe` whose event arrived after the idle gap of `episodeTimeout` (the old episode closes before the new event opens the next one). The misses an intent took from the close are `next.intents[x].episodes.misses - prev.intents[x].episodes.misses`, and the same difference on `next.intents[x].learned[signal].misses` tells you which signals took them. A natural use is to persist immediately when an episode closes, instead of waiting for a debounced save.

## What you have to do

Two things, and the first is the one people forget:

1. **Let episodes end.** Without `endEpisode` or `episodeTimeout`, nothing ever gets a miss, every seen signal looks perfectly predictive, and the base rate climbs to 100%. On the web, call `endEpisode` when the session ends and set `episodeTimeout` as a safety net. On mobile, rely on `episodeTimeout` alone; ending the episode on every app switch would split sessions (see [Using with frameworks](/guide/frameworks#react-native)).
2. **Emit the outcome event** with the exact name in `outcome`. It is an ordinary `observe()` call; nothing else is needed.

## Reference

- [`endEpisode`](/api/functions/endEpisode), [`episodeClosed`](/api/functions/episodeClosed), [`EngineConfig.episodeTimeout`](/api/interfaces/EngineConfig), [`LearningConfig`](/api/interfaces/LearningConfig), [`SignalRecord`](/api/interfaces/SignalRecord), [`EpisodeState`](/api/interfaces/EpisodeState).
