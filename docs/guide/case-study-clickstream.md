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
```

`convert.mjs` also writes `out/stats.json`, the session counts quoted above.
