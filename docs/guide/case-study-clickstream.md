# Case study: a public clickstream

What happens when 2.7 million real events go through `tune` and `replay`. This is a worked example on a public dataset, not a benchmark and not a production shadow log: no app ran oracular over these users and nothing was ever revealed to them. It is here because every number on this site was otherwise computed from scenarios we wrote ourselves, and a real log finds what a scenario cannot. Everything below is reproducible with the published package and the scripts in [`examples/retailrocket`](https://github.com/Yuribenjamin/oracular/tree/main/examples/retailrocket); the runs quoted were made on 2026-10-18 with oracular 0.6.0 and Node 22.

## The data

The [Retailrocket e-commerce dataset](https://www.kaggle.com/datasets/retailrocket/ecommerce-dataset) on Kaggle, published under CC BY-NC-SA 4.0: 2,756,101 events from 1,407,580 visitors of an online shop over 138 days in 2015, each a `view`, an `addtocart` or a `transaction` with a timestamp and a visitor id. The data itself is not in the repository and nothing here redistributes it; the numbers on this page are aggregates. The converter turns it into a recorder log with the visitor id as the install id, every record in shadow mode, and three event names:

| dataset event | recorder event | count |
| --- | --- | --- |
| `view` | `item.viewed` | 2,664,312 |
| `addtocart` | `cart.added` | 69,332 |
| `transaction` | `order.placed`, one per visitor and transaction id | 17,672 (from 22,457 rows, one per item) |

Visitors are split by the parity of their id: the even half is the **fit** log that `tune` reads, the odd half the **holdout** log that `replay` scores, so every score below is on visitors tune never saw. Sessions end after 30 idle minutes, which gives the data this shape:

| | |
| --- | --- |
| sessions | 1,761,672 |
| sessions ending with an order | 14,290 (0.81%) |
| sessions with `cart.added` | 43,924 |
| visitors with one session | 1,225,948 (87%) |
| visitors with two or more | 181,632 |
| order sessions with an earlier session by the same visitor | 6,767 of 14,290 (47%) |
| order sessions with an earlier cart-but-no-order session within 7 days | 2,407 (17%) |
| orders that are the first event of their session | 933 (6.5%) |

Two intents were declared. `purchase` is the real one: `item.viewed` and `cart.added` as signals, `order.placed` as the outcome. `cart` is a straw man kept on purpose, `item.viewed` predicting `cart.added`, to see what the tools say about an intent with nothing to work with.

## A hand-written config, and what replay said

The kind of config one writes before seeing data: a 1% prior with strength 10, a view worth 1, a cart worth 3, a one-day half-life and cooldown.

```json
{
  "episodeTimeout": 1800000,
  "intents": {
    "purchase": {
      "prior": 0.01, "priorStrength": 10, "halfLife": 86400000,
      "signals": { "item.viewed": 1, "cart.added": 3 },
      "outcome": "order.placed",
      "reveal": { "cooldown": 86400000 }
    },
    "cart": {
      "prior": 0.03, "priorStrength": 10, "halfLife": 3600000,
      "signals": { "item.viewed": 1 },
      "outcome": "cart.added",
      "reveal": { "cooldown": 3600000 }
    }
  }
}
```

Replayed on the holdout, `purchase` scores a Brier of 0.0553 where always predicting the base rate scores 0.0462. The hand-written config is worse than knowing nothing. The reliability table says why: after one view, p sits near 0.12 for 1.08 million points whose observed rate is 1.6%. A prior of 1% with strength 10 lets a single view of weight 1 pull p to 10%, and views are everywhere.

## What tune said

`npx oracular tune fit.ndjson --config start.config.json` on 1,370,219 records, 27 seconds with Node's default heap:

```text
purchase: outcome order.placed, 93537 installs, 181080 counted episodes, 8628 with the outcome

| knob          | fitted | was  | from                                                                               |
| ------------- | ------ | ---- | ---------------------------------------------------------------------------------- |
| prior         | 0.0477 | 0.01 | 8628 of 181080 episodes ended with the outcome, smoothed (8628+1)/(181080+2)       |
| priorStrength | 4.0    | 10.0 | spread of base rates across 93537 installs (sd 0.10 around 0.05)                   |
| halfLife      | 1h     | 1d   | lowest Brier score over the grid, 0.0420 (always predicting the base rate: 0.0455) |

| signal      | weight | was  | 90% interval   | lift  | with: hits / misses | without: outcomes / episodes | note                                                                       |
| ----------- | ------ | ---- | -------------- | ----- | ------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| item.viewed | –      | 1.00 | -3.76 to -3.75 | -0.94 | 7621 / 171991       | 1007 / 1468                  | in 99.2% of episodes, so it cannot tell them apart; left out of the config |
| cart.added  | 2.32   | 3.00 | 2.29 to 2.35   | +0.58 | 7321 / 5249         | 1307 / 168510                |                                                                            |

Half-life grid, Brier score against "the outcome follows within 1d" (lower is better): 1h 0.0420 *, 6h 0.0422, 1d 0.0426, 3d 0.0432, 7d 0.0439, 14d 0.0445, 30d 0.0451
```

Four things to read in it:

- **The prior** is 4.8%, not 1%: that is how many sessions end with an order. **The strength** is 4, not 10: visitors differ a lot in how often they buy, so the population's prior should give way quickly to each visitor's own history.
- **`item.viewed` is left out.** It appears in 99.2% of sessions. The 1,468 sessions without it are not ordinary sessions but checkout stubs, a cart and an order with no browsing, and 69% of them end with an order. Measured against them, the contrast would make a view a strong signal *against* buying (the interval, −3.76 to −3.75, is confident and wrong). This log is where that rule came from: on the holdout, the contrast weight scores 0.0429, keeping the hand-written weight of 1 scores 0.1032, and leaving the signal out scores 0.0416.
- **`cart.added` is worth 2.32**, with a tight interval: 58% of the sessions with a cart end with an order against 0.8% of those without.
- **The half-life** moved from a day to an hour, by 1.4% of the Brier score. The gain is real but small, and the grid shows the shape: the score rises steadily from 1h to 30d.

The straw man got the sentence it deserved:

```text
This intent does not beat its base rate: the fitted config scores 0.0629 where always predicting the base rate scores 0.0487 (lower is better). No signal is left in the config, so p never leaves the prior, and the prior (the share of episodes that end with cart.added) is not the share of events that cart.added follows within 1h. Drop the intent, or find signals that tell its episodes apart (--all-events measures every other event in the log).
```

## Scored on visitors tune never saw

`npx oracular replay holdout.ndjson --config <config>` on 1,381,097 records, 7 seconds each. The `purchase` intent, window one day, base-rate Brier 0.0462:

| config | Brier | reveals at 0.3 | precision | recall | reveals at 0.5 | precision |
| --- | --- | --- | --- | --- | --- | --- |
| hand-written | 0.0553 | 4157 | 23.4% | 19.3% | 431 | 28.3% |
| tuned, `item.viewed` at its contrast weight −3.75 | 0.0429 | 292 | 15.1% | 0.7% | 15 | 6.7% |
| tuned, `item.viewed` kept at the hand-written 1 | 0.1032 | 10871 | 25.9% | 46.1% | 668 | 31.9% |
| **tuned, as printed** | **0.0416** | **1688** | **29.0%** | **8.9%** | **74** | **25.7%** |
| tuned, per-user learning off | 0.0421 | 1690 | 27.3% | 6.7% | 74 | 21.6% |

The tuned config is 10% better than the base rate, and a reveal at threshold 0.3 is followed by an order within a day 29% of the time, six times the base rate, with a median lead of 11 minutes. The recall is low, and the tuning guide says why: with a prior of 4.8% and strength 4, the gate at 0.3 with the default `z` needs 3.85 pseudo-counts of evidence. One `cart.added` adds 2.32 and puts p at 0.40, but the lower bound at 0.17; the third cart add in a session opens the gate. Most sessions that end with an order have fewer. A shop that wants to act on the first cart add would lower `z`, at a cost in precision; see [Tuning](/guide/tuning#threshold-and-z).

Per-user learning is worth 1.1% of the score here and two points of precision. That is the expected size: 87% of these visitors have a single session, so for most of them the engine never sees a verdict.

## The rule a skeptic would write

Every reviewer asks the same question: would a hand-written rule do as well? The obvious one here is *reveal when `cart.added` has happened k times in this session*. `baseline-rules.mjs` scores it exactly as replay scores a reveal: the same 30-minute sessions, an order within a day counts, no second reveal for a day after a reveal or an order, and windows that run past the end of the log are not scored. A rule has no probability, so there is no Brier score to compare; precision and recall at matching operating points are the fair test.

| policy | reveals | precision | recall | median lead |
| --- | --- | --- | --- | --- |
| rule: `cart.added` ≥ 1 in a session | 20329 | 27.6% | 79.2% | 5 min |
| oracular, threshold 0.3, `z` 0 | 20307 | 27.6% | 79.1% | 5 min |
| rule: `cart.added` ≥ 2 | 4025 | 27.9% | 16.7% | 10 min |
| oracular, threshold 0.5, `z` 0 | 3063 | 26.2% | 14.3% | 9 min |
| rule: `cart.added` ≥ 3 | 1702 | 27.8% | 7.1% | 12 min |
| oracular, threshold 0.3, default `z`, learning off | 1690 | 27.3% | 6.7% | 11 min |
| **oracular, threshold 0.3, default `z`** | **1688** | **29.0%** | **8.9%** | **11 min** |

Read the ties first. For a visitor the engine has never seen, the tuned gate *is* the rule: with one signal left in the config, "p and its lower bound clear 0.3" means "the third cart add of the session", and with the confidence gate off it means "the first". The rows pair up, and oracular with learning switched off lands within half a point of the rule on both measures. Nothing else would be honest: a Bayesian gate over one signal and a counter over one signal are the same policy until there is something to learn.

Then read where they part. At the same 1,690 reveals, learning lifts precision from 27.3% to 29.0% and recall from 6.7% to 8.9%, against a rule that cannot move. The gain is small because 87% of these visitors have one session. Where visitors come back, the gap is the point: among the 29,391 holdout visitors with three or more sessions, 4,844 orders:

| policy, returning visitors only | reveals | precision | recall | median lead |
| --- | --- | --- | --- | --- |
| rule: `cart.added` ≥ 3 | 721 | 34.7% | 8.4% | 17 min |
| stateful rule: ≥ 3, unless 3+ cart sessions without an order since the last order | 664 | 36.3% | 8.2% | 19 min |
| stateful rule: ≥ 3, unless 2+ fruitless cart sessions | 621 | 37.7% | 7.9% | 19 min |
| stateful rule: ≥ 3, unless 1+ fruitless cart session | 508 | 39.2% | 6.4% | 20 min |
| oracular, threshold 0.3, learning off | 720 | 34.0% | 7.9% | 19 min |
| **oracular, threshold 0.3, tuned config as printed** | **718** | **38.0%** | **12.0%** | **16 min** |
| oracular, threshold 0.4 | 240 | 37.9% | 4.5% | 28 min |
| oracular, threshold 0.5 | 36 | 41.7% | 1.0% | 14 min |
| oracular, threshold 0.3, `learning.priorEpisodes` 5 | 703 | 39.5% | 14.3% | 17 min |
| oracular, threshold 0.3, `priorEpisodes` 3 | 687 | 41.2% | 16.0% | 17 min |
| **oracular, threshold 0.3, `priorEpisodes` 3, `gain` 3** | **829** | **46.4%** | **24.8%** | **16 min** |
| oracular, threshold 0.4, `priorEpisodes` 3, `gain` 3 | 292 | 53.1% | 13.0% | 25 min |

At the same number of reveals as the plain rule, the printed config has 3.3 points more precision and catches 43% more orders, because the engine has learned which of these visitors fill carts and never buy and which buy whenever they do. The visitor from the next section with 39 cart sessions and about nine orders needs more than three cart adds before the engine speaks; the one with 93 hits and one miss needs fewer. A rule treats them alike.

The next skeptic asks whether that is Bayesian learning or just having memory, so the table has a stateful rule too: the third cart add, unless this visitor has already had N cart sessions without an order since their last order. Memory does buy precision, and at N = 1 the rule is a point the printed config does not beat: 39.2% against 38.0%, at half the recall. Nor does raising oracular's threshold reach it. With one signal in the config, a higher threshold only demands a fourth or fifth cart add in the session, so the threshold rows trade recall away for nothing: 0.4 is less precise than 0.3 and catches a third of the orders. The threshold is the wrong knob for this question; it moves the gate, not the memory.

The knob that matches the rule's memory is the learner's own: `learning.priorEpisodes`, how many episodes of a visitor's history it takes to weigh as much as the population's weight, and `learning.gain`, how far that history may move the weight. `tune` does not fit either, so these rows were chosen on the fit half's returning visitors and are quoted here on the holdout's, which the choice never saw. Every one of them beats every rule point on both measures at once. With `priorEpisodes` 3 and `gain` 3 the engine trusts a visitor's history after three sessions and lets it triple a weight: 829 reveals at 46.4% precision catching 24.8% of orders, against the best rule's 39.2% and 6.4%; and its Brier score improves too, 0.1140 against 0.1165 for the printed config. On the whole holdout the same setting scores 0.0410 against 0.0416, 33.5% precision and 15.8% recall at 0.3 against 29.0% and 8.9%. The frontier is not one point oracular happens to hold; the rule's whole curve sits below it.

That is also the answer to the clause the next skeptic will add. Skip after N fruitless sessions, fire earlier for past buyers, forgive after an order, weigh recent sessions more: each is a hand-coded piece of the learner, with its own constant to pick and its own bug to find. The table is what you get for writing it down once as math, with two constants, and letting the data set them.

Three other things the rule does not have, none of which shows in this table: a calibrated probability at every event (the Brier scores above), a gate that moves to another operating point by changing a number rather than rewriting the rule (the last row), and decay, which here is a one-hour half-life that lets the morning's two cart adds fade before the evening's one rather than count toward it. On a population with longer intents and more returning users, those are the rows to add.

## Attribution, on and off

[Cross-episode attribution](/guide/concepts/episodes-and-learning#credit-across-episodes) lets a session that ends without the order wait for it. On this data, 17% of orders follow an earlier cart-but-no-order session within a week, so there is something to credit. Scored on the holdout with the tuned config:

| `attribution` | Brier | reveals at 0.3 | precision | recall |
| --- | --- | --- | --- | --- |
| off | 0.04164 | 1688 | 29.0% | 8.9% |
| 1 hour (the half-life) | 0.04164 | 1696 | 29.1% | 9.0% |
| 1 day | 0.04166 | 1700 | 29.1% | 9.0% |

Neutral, and for the same reason learning itself is small here: attribution changes what the engine learns about a user across sessions, and most users have one. Among the visitors who came back it does what it says (next section). The feature is for days-scale intents with returning users, and this population is not one. It cost nothing in time.

## The visitors who came back

`returning-buyers.mjs` is an app's view of the engine: every holdout visitor with three or more sessions and at least one order, 1,887 of them with 4,844 orders, run through `observe`, `endEpisode`, `predict`, `shouldReveal` and `explain` with the tuned config, with and without attribution, persisting the state through `serialize` and `deserialize` at every episode close. 1.9 seconds for both runs.

- The state round-tripped 15,349 times without a byte of difference.
- The mean p just before an order is 0.40, against a 4.9% base rate. 12.2% of orders had a reveal at threshold 0.3 within the previous day; 12.3% with attribution.
- With attribution set to the half-life, 194 visitors end with fractional credit on `cart.added`, and the pooled count moves from 4127 hits and 1363 misses to 4302 and 1111: the cart sessions that preceded an order by less than an hour got their share. No visitor ever had more than two sessions waiting.
- Per-user learning shows up where it should. One visitor with 1,591 events added to the cart in 39 sessions, about nine of which ended with an order; `cart.added` ends at an effective weight of 1.28 for them, down from 2.32. Another, with 93 hits against one miss, ends at 3.76.

## What the data changed in oracular

- **A crash.** Both CLI commands died on logs past about a hundred thousand records, because a file's entries were spread into one `push` call. Fixed in 0.5.1, with a test at 150,000 records.
- **Three tune rules**, in 0.5.2: ubiquitous signals are left out, a flat grid keeps the current half-life and the report prints four decimals, and an intent that does not beat its base rate is told so. Each came from a line in the output above.
- **A measured gap.** Before attribution existed, this data put a number on what it would address: 17% of orders had an earlier cart session within a week. After it shipped, the same data showed the effect is neutral on a one-session population, which is the honest thing to know.

## Limits

This is a server-side clickstream, not an oracular shadow log. No reveal was shown, so "precision" means "would have been followed by an order", with the usual [shadow mode](/guide/shadow-mode) caveats about what a reveal would itself have caused. Sessions are a 30-minute gap imposed on timestamps, not the app's own boundaries. One shop, one summer, one domain; a split by visitor parity rather than by time, so a config tuned in May is not tested on September. And the `cart` intent was built to fail. The production case study the [roadmap](/guide/roadmap) asks for, a shadow log from an app that ran the engine, is still to come.

## Reproduce

```sh
# download events.csv from Kaggle (see the dataset's licence), then:
node examples/retailrocket/convert.mjs path/to/events.csv out/
npx oracular tune out/fit.ndjson --config examples/retailrocket/start.config.json
# paste the printed config into out/tuned.config.json
npx oracular replay out/holdout.ndjson --config out/tuned.config.json
node examples/retailrocket/returning-buyers.mjs out/holdout.ndjson out/tuned.config.json
node examples/retailrocket/baseline-rules.mjs out/holdout.ndjson 1 2 3 3:1 3:2 3:3   # k, or k:N for the stateful rule
```

`convert.mjs` also writes `out/stats.json`, the session counts quoted above. For the returning-visitor rows, filter each half to visitors with three or more sessions before running `replay` and `baseline-rules.mjs` on it; the learning rows add `"learning": { "priorEpisodes": 3, "gain": 3 }` to the tuned config.
