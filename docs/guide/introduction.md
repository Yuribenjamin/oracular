# Introduction

**oracular** is a tiny, zero-dependency, pure-functional intent engine that runs entirely on the device. Your app feeds it the events it already emits. The engine keeps, for each *intent* you declare (upgrade, churn, get stuck, buy…), a probabilistic estimate of how likely the user is to do that thing, and tells you when the estimate crosses a threshold **with enough confidence** to act on: show a tip, make an offer, reveal a feature, place an ad.

It is about 4 kB gzipped, has no dependencies, and contains no I/O of any kind.

## What it is

- **A per-intent probability with a confidence bound.** Each intent is a Beta distribution. Signals add evidence, time takes it away, and [`predict`](/api/functions/predict) gives you p, its standard deviation and a lower bound.
- **A gate.** [`shouldReveal`](/api/functions/shouldReveal) is true only when both p and the lower bound clear your threshold, and no cooldown is running. Thin evidence with a high mean does not fire.
- **A learner.** The weights you give signals are priors. Every episode in which a signal is followed by the intent's outcome is a hit, every episode where it isn't is a miss, and the signal's weight drifts toward what this user's own history supports, judged against the sessions in which the signal did not appear. See [Episodes & learning](/guide/concepts/episodes-and-learning).
- **An explainer.** [`explain`](/api/functions/explain) returns, per signal, how much evidence it holds and how much p would move without it. You can always see why something fired.

## What it isn't

- **Not analytics.** It counts nothing across users, aggregates nothing, reports nothing. There is no dashboard because there is no server.
- **Not an experimentation tool.** It does not assign variants or measure lift across a population.
- **Not a rules engine.** There is no `if pricing viewed twice then…`. There is a probability, a confidence bound and a threshold, and the weights behind them are corrected by the user's own behaviour.
- **Not a model you train offline.** You write down your beliefs as priors. The only training data is the one user's events, on their device, and it never leaves it.
- **Not a scheduler or a store.** You pass time in; you persist the state. The library has no clock and no storage.

## Why on-device

- **Privacy that doesn't depend on policy.** Nothing leaves the device because nothing in the library can send anything. There is no network code to audit, misconfigure or breach.
- **No pipeline.** No events to batch, ship, store, secure or delete. The state is a small JSON object the app owns.
- **Instant and offline.** Every call is a synchronous pure function over a plain object. It works on a plane.
- **Per-user by construction.** Learning happens per device, so the engine adapts to the person in front of it, not to the average of everyone.

## How it fits in your app

```
your events ──▶ observe ──▶ state ──▶ predict · shouldReveal · explain
                              │
                        serialize ──▶ your storage ──▶ deserialize (with your current config)
```

You own three things: **time** (every call takes an `at` timestamp), **persistence** (`serialize` / `deserialize`), and **side effects** (what you show when `shouldReveal` is true, and calling `markRevealed` afterwards).

## Where to go next

- [Installation](/guide/installation) and the [Quickstart](/guide/quickstart).
- The six concept pages, starting with [Intents & priors](/guide/concepts/intents-and-priors).
- The [Tuning guide](/guide/tuning) when you want numbers.
- The [Playground](/playground) to click through all of it in your browser.
