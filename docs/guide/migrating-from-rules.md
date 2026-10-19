# Migrating from hand-written rules

Most apps that would use oracular already have a rule: *show the offer on the third cart add*, *suggest help after five undos*. This page replaces one with the engine, step by step, and keeps the rule as the baseline the engine has to beat. Every number comes from [Case study: a public clickstream](/guide/case-study-clickstream), where this path was walked on 2.7 million events, and the section it comes from is named so you can check it.

## 0. Score the rule you have

A rule has no probability, so it has no Brier score, but it has a precision and a recall at its operating point, and those are what the engine will be measured against. The case study's rule is "reveal when `cart.added` has happened k times in this session", scored exactly as `replay` scores a reveal: thirty idle minutes end a session, an order within a day counts, no second reveal for a day after a reveal or an order. [`baseline-rules.mjs`](https://github.com/Yuribenjamin/oracular/blob/main/examples/retailrocket/baseline-rules.mjs) does it for a recorder log; adapt it to whatever log you have. On the holdout half of the clickstream, from [The rule a skeptic would write](/guide/case-study-clickstream#the-rule-a-skeptic-would-write):

| rule | reveals | precision | recall | median lead |
| --- | --- | --- | --- | --- |
| `cart.added` ≥ 1 in a session | 20329 | 27.6% | 79.2% | 5 min |
| `cart.added` ≥ 2 | 4025 | 27.9% | 16.7% | 10 min |
| `cart.added` ≥ 3 | 1702 | 27.8% | 7.1% | 12 min |

Write yours down the same way before anything else. It is the row the engine must not fall below.

## 1. Write the rule as a config

A rule names its signals and, implicitly, its outcome. The config is the same statement with the counts made explicit: a prior (how often the outcome happens in a session), a strength (how many observations that prior is worth), a weight per signal and a half-life. The first version is a guess, and the case study's guess was the kind everyone writes, from [A hand-written config, and what replay said](/guide/case-study-clickstream#a-hand-written-config-and-what-replay-said) (its second, straw-man intent left out here):

```json
{
  "episodeTimeout": 1800000,
  "intents": {
    "purchase": {
      "prior": 0.01, "priorStrength": 10, "halfLife": 86400000,
      "signals": { "item.viewed": 1, "cart.added": 3 },
      "outcome": "order.placed",
      "reveal": { "cooldown": 86400000 }
    }
  }
}
```

Nothing about it is final. The point of the next two steps is that you do not have to live with a guess.

## 2. Run it in shadow mode

Ship the config with reveals off: the engine computes every decision, your app writes one line per event with `createRecord`, and shows nothing. [Shadow mode](/guide/shadow-mode) has the record format and the loop. Collect for a few weeks, until the outcome has happened a few hundred times across users.

## 3. Let `tune` write the config

`npx oracular tune shadow.ndjson --config start.config.json` reads what the engine counted across your users and prints the config to ship. On the clickstream's fit half, 181,080 counted episodes, it said this ([What tune said](/guide/case-study-clickstream#what-tune-said)):

- the prior moved from 0.01 to 0.0477, the share of sessions that end with an order;
- the strength from 10 to 4, because visitors differ a lot in how often they buy;
- `cart.added` from 3 to 2.32, with a 90% interval of 2.29 to 2.35;
- `item.viewed` was left out: it appears in 99.2% of sessions, so it cannot tell them apart;
- the half-life from a day to an hour, the lowest Brier score on the grid.

Paste the printed config. It is the population's answer; on each device the engine corrects it from that user's own outcomes.

## 4. Replay both, and the rule

`npx oracular replay holdout.ndjson --config <config>` scores a config on a log, so the guess and the tuned config are scored on the same footing ([Scored on visitors tune never saw](/guide/case-study-clickstream#scored-on-visitors-tune-never-saw)):

| config | Brier | reveals at 0.3 | precision | recall |
| --- | --- | --- | --- | --- |
| always predicting the base rate | 0.0462 | | | |
| hand-written | 0.0553 | 4157 | 23.4% | 19.3% |
| tuned, as printed | 0.0416 | 1688 | 29.0% | 8.9% |

The guess was worse than knowing nothing: a 1% prior with strength 10 lets a single view of weight 1 pull p to 10%, and views are everywhere. The tuned config is 10% better than the base rate.

Now the rule. With one signal left in the config, the tuned gate at threshold 0.3 *is* the rule "third cart add", and the table says so ([The rule a skeptic would write](/guide/case-study-clickstream#the-rule-a-skeptic-would-write)):

| policy | reveals | precision | recall |
| --- | --- | --- | --- |
| rule: `cart.added` ≥ 3 | 1702 | 27.8% | 7.1% |
| oracular, threshold 0.3, learning off | 1690 | 27.3% | 6.7% |
| oracular, threshold 0.3, as printed | 1688 | 29.0% | 8.9% |

For a visitor the engine has never seen, a Bayesian gate over one signal and a counter over one signal are the same policy, and the rows land within half a point of each other. That is the migration's first checkpoint: nothing lost.

## 5. Where the rule and the engine part

The rule cannot move. The engine learns, per visitor, which of them fill carts and never buy and which buy whenever they do. On the holdout visitors with three or more sessions, 29,391 of them with 4,844 orders, from the same section:

| policy, returning visitors only | reveals | precision | recall |
| --- | --- | --- | --- |
| rule: `cart.added` ≥ 3 | 721 | 34.7% | 8.4% |
| stateful rule: ≥ 3, unless 1+ fruitless cart session since the last order | 508 | 39.2% | 6.4% |
| oracular, threshold 0.3, as printed | 718 | 38.0% | 12.0% |
| oracular, threshold 0.3, `learning.priorEpisodes` 0.5, `gain` 4 | 945 | 48.9% | 27.9% |

At the plain rule's number of reveals, the printed config has 3.3 points more precision and catches 43% more orders. The stateful rule, the next thing a reviewer writes, buys precision by speaking less. Two constants on the learner, fit on the other half of the data and scored once here, beat every rule row on both measures at once. Each clause you would add to the rule instead (skip after N fruitless sessions, fire earlier for past buyers, forgive after an order) is a hand-coded piece of that learner, with its own constant to pick and its own bug to find.

## 6. Switch the reveal on, and keep the log

Turn reveals on for a share of users and keep recording. `replay` scores only the periods in which reveals were not shown, because once they are, the reveal itself causes outcomes. The rule stays in the repository as the baseline, and the next time someone asks whether the engine still earns its place, step 0 is one command away.

## What this does not claim

The clickstream is a server-side log, not a shadow log from an app that ran the engine, so "precision" means "would have been followed by an order", with the caveats in [Limits](/guide/case-study-clickstream#limits). One shop, one summer, one domain. The path is the point; the numbers are what it produced once.
