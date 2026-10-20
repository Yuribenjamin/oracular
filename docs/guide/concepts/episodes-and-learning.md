# Episodes & learning

The weights you write in the config are guesses. oracular corrects them with the only data that is both relevant and available on the device: whether, for *this* user, a signal tends to be followed by the intent's outcome.

## Episodes

An **episode** is a session. Any event opens one if none is open and extends it otherwise. An episode ends when:

- your app calls [`endEpisode`](/api/functions/endEpisode) (sign-out), or
- `config.episodeTimeout` is set and the next event arrives after a longer idle gap. The old episode is then closed at the moment it timed out, before the new event is applied.

One episode is open at a time, shared by all intents. Within it, every intent remembers which of its signals it has **seen**, and how many times, so that [repeats within the episode add less](/guide/concepts/signals-and-weights#repeats-within-an-episode). Learning counts each seen signal once per episode, however often it occurred.

## Hits and misses

Each intent may name an `outcome` event, the thing it predicts:

```ts
upgrade: { signals: { 'pricing.viewed': 3, 'limit.hit': 2 }, outcome: 'upgrade.completed', /* … */ }
```

- When the outcome arrives, every signal seen in the episode gets a **hit**, the intent counts one episode *with* the outcome toward its **base rate**, the seen list is cleared and the intent is marked resolved for this episode. By default the intent's evidence is also reset; see [Outcomes & cooldowns](/guide/concepts/outcomes-and-cooldowns).
- When the episode ends without the outcome, every seen signal gets a **miss** and the intent counts one episode *without* the outcome. Episodes in which the intent saw no signal at all still count toward the base rate, because they are sessions in which the outcome did not happen. With `attribution` set, the episode waits for the outcome instead; see [Credit across episodes](#credit-across-episodes).
- Signals seen *after* an outcome in the same episode are neutral at episode end: they get a hit if a second outcome arrives, nothing otherwise.

An outcome event that no episode preceded still counts toward the base rate. An event that is both a signal and the outcome of the same intent is never remembered as seen, so it cannot learn from itself.

## Credit across episodes

By default a signal earns a hit only when the outcome arrives in the same episode. For an intent that builds over days, the sessions that built it take misses and the session where the user finally acts gets all the credit ([What oracular can and cannot learn](/guide/can-and-cannot-learn#credit-stays-inside-the-episode)). `IntentConfig.attribution`, a duration, changes the verdict on a closed episode from "a miss, now" to "wait and see":

- When an episode ends without the outcome, the intent **holds** it (`IntentState.pending`: when it closed and which signals it saw) instead of counting it.
- When the outcome arrives, the current episode's signals get a full hit as before, and every held episode gets a **share** of a hit, `c = 2^(−age / halfLife)` with `age` counted from its close, and `1 − c` of a miss. The base rate gets the same shares. The list is then empty.
- When a held episode's window passes without the outcome, it is a **miss**, recorded at the moment the window ended. With `learning.halfLife` set, that miss is decayed from that moment, as a timed-out episode's miss is decayed from the timeout.
- At most 32 episodes wait per intent; past that the oldest is a miss at once.

The share is the intent's own evidence decay: the credit a Monday signal gets for a Thursday upgrade equals the fraction of its weight the engine still counts toward p on Thursday. Prediction and learning run on one clock, and there is no second knob to tune. `hits + misses` still counts each episode once, so everything in the next section holds unchanged.

The quickstart `upgrade` intent (half-life one week) with `attribution` of two weeks. Monday 10:00, a session with `pricing.viewed` and `limit.hit` ends at 10:10; the upgrade arrives later, in a session of its own. What Monday's signals and the base rate record, generated from the engine:

<!-- generated:attribution-credit-table -->
| the upgrade arrives | age of Monday's session | share of a hit | `pricing.viewed` hits / misses | episodes with / without the outcome |
| ------------------- | ----------------------- | -------------- | ------------------------------ | ----------------------------------- |
| Tuesday 10:10 | 1 day | 0.906 | 0.906 / 0.094 | 1.906 / 0.094 |
| Thursday 10:10 | 3 days | 0.743 | 0.743 / 0.257 | 1.743 / 0.257 |
| next Monday 10:10 | 7 days | 0.500 | 0.500 / 0.500 | 1.500 / 0.500 |
| two Mondays later | 14 days | 0.250 | 0.250 / 0.750 | 1.250 / 0.750 |
| never: the window passes | – | – | 0.000 / 1.000 | 0.000 / 1.000 |
<!-- /generated:attribution-credit-table -->

Resolved episodes are untouched: signals seen after an outcome in the same episode stay neutral at the close, as before. Reads (`explain`, `evaluate`, `predict`) settle episodes whose window has passed in what they show, and store nothing; the next `observe` stores the same verdict. `attribution` is off unless set. A natural first value is the intent's `halfLife`, where the smallest share inside the window is one half; leave it unset for intents measured in minutes, whose sessions rightly end as misses.

## From hits and misses to a weight

For a signal with initial weight `w₀`, `hits` and `misses`, inside an intent that has seen `episodes` episodes of which `outcomes` ended with the outcome:

```
nWith     = hits + misses                                       episodes in which the signal was seen
nWithout  = episodes − nWith                                    episodes in which it was not
qWith     = (hits + 1) / (nWith + 2)                            outcome rate with the signal
qWithout  = (outcomes − hits + 1) / (nWithout + 2)              outcome rate without it
lift      = (qWith − qWithout) / (1 − qWithout)   if qWith ≥ qWithout
          = (qWith − qWithout) / qWithout         otherwise      → in [−1, 1]
learned   = gain × |w₀| × lift                                  0 while nWith = 0
nEff      = (nWith × nWithout) / (nWith + nWithout)             0 if either side is 0
effective = (k × w₀ + nEff × learned) / (k + nEff)              k = learning.priorEpisodes
```

Both rates are Laplace-smoothed (+1 / +2). The formula shown is the default normalized difference. Learning options live under `config.learning`:

- **`gain`** (default 2) caps the learned estimate for every lift option: `learned` lives in [−gain·|w₀|, gain·|w₀|]. The effective weight blends this estimate with your initial weight, so when `gain < 1` it can initially exceed the learned cap while it moves away from the prior.
- **`priorEpisodes`** (default 10) is how much contrast it takes for the user's history to weigh as much as your initial weight. The signal's strength (`w₀`) and your confidence in it (`k`) are deliberately separate things.

## Choosing a lift formula

`learning.lift` chooses an association measure. Each measure is converted to a signed evidence
score in [−1, 1], where zero means no association. Leave it unset to keep the existing normalized
difference exactly. Different choices change sensitivity to differences in outcome rates, while
preserving the meaning of negative weights and the cap set by `gain`.

Choose a formula when constructing the engine:

```ts
const state = createState({
  intents,
  learning: { lift: 'relative-lift' },
});
```

`learning.lift` accepts these names. Here `q` is the outcome rate with the signal and `b` the
outcome rate without it, both Laplace-smoothed as above.

| Name | Raw formula | Common use case |
| --- | --- | --- |
| `'absolute-difference'` | `q − b` | A/B testing, changes in conversion probability |
| `'relative-lift'` | `(q − b) / b` | Marketing, percentage improvement |
| `'risk-ratio'` | `q / b` | Epidemiology, comparing risks |
| `'log-lift'` | `ln(q / b)` | Statistical modeling, additive scoring |
| `'odds-ratio'` | `(q / (1 − q)) / (b / (1 − b))` | Logistic regression, medical research |
| `'normalized-difference'` (default) | `(q − b) / (1 − b)` if `q ≥ b`, else `(q − b) / b` | Bounded adaptive weighting |
| `'association-rule'` | `P(A,B) / (P(A) × P(B))` | Market baskets, recommendations |

For association-rule lift, `A` means the signal occurred and `B` means the outcome occurred.
The engine adds one to each of the four cells of this contingency table, consistent with the
Laplace smoothing of `q` and `b`. The overall outcome rate is therefore
`P(B) = (outcomes + 2) / (episodes + 4)`, and lift is `q / P(B)`. This differs from the risk
ratio, which compares with episodes without the signal. For example, two successful signal
episodes and three unsuccessful episodes without it give `P(A,B) = 3/9`, `P(A) = 4/9`,
`P(B) = 4/9`, and lift `27/16`.

The raw measure is converted before it enters `learned = gain × |w₀| × score`:

| Measure | Evidence score |
| --- | --- |
| Absolute and normalized difference | The raw value, already in [−1, 1] |
| Risk ratio, odds ratio, association-rule lift | `(R − 1) / (R + 1)` |
| Relative and log lift | `x / (1 + abs(x))` |

Every score is neutral at zero, negative below the baseline, and bounded within [−1, 1]. A ratio
of 1 therefore learns a weight of zero, a ratio of 3 gives a score of 0.5, and a ratio of 1/3
gives −0.5. The transforms are monotone; they preserve direction but change scale. Relative lift
is asymmetric: its raw minimum is −1, so its score approaches −0.5 for strong negative association,
while its positive score can approach 1. Normalized and absolute difference keep their original
arithmetic. Ratio/log inputs are clamped to `[Number.EPSILON, 1 − Number.EPSILON]`: tuning's
Wilson interval endpoints can be exactly 0 or 1, even when the estimated rate is Laplace-smoothed.
The clamp keeps both raw metrics and evidence scores finite at these endpoints, and when large
smoothed counts round to them.

`oracular tune` uses the same score for declared and candidate signal weights and intervals.
Its JSON report includes both `lift` (raw) and `score`; the text table adds a score column when
they differ. Weights are `priorStrength × score`, rounded to two decimals, and interval endpoints
stay within ±`priorStrength`. Existing learned counts remain usable. Evidence already accumulated
with an older formula is retained until decay or an outcome reset; it is not replayed on load.

## Learning needs contrast

With the default lift, a signal is judged by comparing the sessions it appeared in with the sessions it did not appear in. Does the outcome happen more often when the signal is present than when it is absent? That is the only question the signal can answer, and both halves of it have to exist before the answer means anything.

`nEff` is how much of both halves has been seen. It is the harmonic-mean-style count `(nWith × nWithout) / (nWith + nWithout)`: with 10 sessions on each side it is 5; with 1 on one side and 5 on the other it is 0.83; with 0 on either side it is 0. The blend then mixes your weight and the learned one in proportion to `k` against `nEff`, so:

- A signal that has been **present but never absent** (it fired in every session so far) has no counterfactual. `nEff` is 0 and the developer's weight stands, exactly, no matter how many sessions there have been.
- A signal that has been **absent but never present** has nothing to learn from either; `learned` is 0 and `nEff` is 0.
- A signal seen in one session and absent from five has a little contrast, and moves a little.

Using the overall base rate (as association-rule lift does) judges a signal partly against its
own sessions, so its baseline moves with its prevalence. The default compares two disjoint
groups instead. Every formula keeps the same contrast blend: without both groups, the initial
weight stands. Comparing against a fixed 50% would wrongly read every signal of a rare outcome
as negative.

## Worked example

Twenty sessions. In ten, signal `A` (weight 1) is seen and the outcome follows. In the other ten, signal `B` (weight 1) is seen and nothing follows.

```
A: hits 10, misses 0     qWith_A    = 11/12 = 0.917
   other 10 sessions, 0 outcomes      qWithout_A = 1/12  = 0.083
B: hits 0,  misses 10    qWith_B    = 1/12  = 0.083
   other 10 sessions, 10 outcomes     qWithout_B = 11/12 = 0.917

lift_A = (0.917 − 0.083) / (1 − 0.083) = +0.909    learned_A = 2 × 1 × 0.909 = +1.82
lift_B = (0.083 − 0.917) / 0.917       = −0.909    learned_B = −1.82

nEff = (10 × 10) / (10 + 10) = 5  for both

effective_A = (10 × 1 + 5 × 1.82) / 15 = +1.27
effective_B = (10 × 1 − 5 × 1.82) / 15 = +0.06
```

After twenty sessions, `A` counts 27% more than you said and `B` has all but vanished. With `priorEpisodes: 2` the same history gives `A` 1.58; with `50` it gives 1.07. These numbers are pinned by the test suite.

## Early-episode learning

The first confirmed episode does not move a signal's weight at all. After one session in which `A` was seen and the outcome followed, `A` has been present once and absent never: there is no session without it to compare against, `nEff` is 0, and `effective` equals `w₀` exactly. The same holds for the second and third confirmed sessions, and for however many it takes until a session happens without `A`.

Once there are sessions without it, the weight starts to move, and in the direction the contrast supports. One confirmed session with `A`, then five sessions with neither `A` nor the outcome: `qWith = 2/3`, `qWithout = 1/7`, `lift = 0.61`, `learned = 1.22 × w₀`, `nEff = (1 × 5) / 6 = 0.83`, and

```
effective = (10 × w₀ + 0.83 × 1.22 × w₀) / 10.83 = 1.017 × w₀
```

A small rise, because there is still only a little contrast; `priorEpisodes` sets how much contrast it takes before the user's history weighs as much as your guess. Nothing drifts after a single outcome, in either direction. (In 0.1.x the blend used the plain count of sessions with the signal, which let a single confirmed session pull the weight down by a factor `k / (k + 1)`; that is gone.)

## Signals present in every episode

A signal that fires in every session, like `app.opened`, keeps its initial weight exactly. Learning needs contrast, and a signal that has never been absent has no counterfactual: nothing in this user's history can say whether the outcome is more likely with it than without it. It still contributes its configured weight to p on every occurrence; it simply never learns. Give such signals a small weight, or none, and let the discriminating signals carry the intent.

## Forgetting

By default learned counts never decay: what the user did six months ago still counts as much as yesterday. Set `learning.halfLife` to let old hits and misses fade, typically with a half-life of months rather than days.

## Detecting an episode close

An episode closed between two states when the previous one had an episode open and the next one has a different one (or none):

```ts
prev.episode.startedAt !== null && next.episode.startedAt !== prev.episode.startedAt
```

[`episodeClosed(prev, next)`](/api/functions/episodeClosed) is that rule as a function. It is true across `endEpisode`, and across an `observe` whose event arrived after the idle gap of `episodeTimeout` (the old episode closes before the new event opens the next one). The misses an intent took from the close are `next.intents[x].episodes.misses - prev.intents[x].episodes.misses`, and the same difference on `next.intents[x].learned[signal].misses` tells you which signals took them; for an intent with `attribution` set the difference is 0 at the close, because its verdict waits. A natural use is to persist immediately when an episode closes, instead of waiting for a debounced save.

## What you have to do

Two things, and the first is the one people forget:

1. **Let episodes end.** Without `endEpisode` or `episodeTimeout`, nothing ever gets a miss, every seen signal looks perfectly predictive, and the base rate climbs to 100%. Set `episodeTimeout` and rely on it, on the web as on mobile, and call `endEpisode` on sign-out. Ending the episode on `pagehide` or on every app switch would split sessions (see [Using with frameworks](/guide/frameworks)).
2. **Emit the outcome event** with the exact name in `outcome`. It is an ordinary `observe()` call; nothing else is needed.

## Reference

- [`endEpisode`](/api/functions/endEpisode), [`episodeClosed`](/api/functions/episodeClosed), [`EngineConfig.episodeTimeout`](/api/interfaces/EngineConfig), [`IntentConfig.attribution`](/api/interfaces/IntentConfig), [`LearningConfig`](/api/interfaces/LearningConfig), [`SignalRecord`](/api/interfaces/SignalRecord), [`PendingEpisode`](/api/interfaces/PendingEpisode), [`EpisodeState`](/api/interfaces/EpisodeState).
