# Intents & priors

An **intent** is one thing the user might be about to do: upgrade, churn, buy, get stuck. You declare intents in the config, and the engine keeps an independent estimate for each.

## An intent is a Beta distribution

Internally an intent is a Beta(α, β) distribution over "the probability that this user is about to do this". Its mean is the estimate you read as `p`:

```
p = α / (α + β)
```

The two parameters are pseudo-counts: α is evidence *for* the intent, β is evidence *against*. Signals add to one or the other, and time pulls both back toward where they started.

## The prior

Two config fields set the starting point:

```ts
upgrade: {
  prior: 0.05,        // how likely, before seeing anything
  priorStrength: 10,  // how firmly you hold that belief, in observations
  // ...
}
```

They become the initial parameters:

```
α₀ = prior × priorStrength        = 0.05 × 10 = 0.5
β₀ = (1 − prior) × priorStrength  = 0.95 × 10 = 9.5
```

`prior` is where p sits with no evidence, and where it returns when evidence decays. A good first value is the fraction of users (or sessions) that actually do the thing: if 5% of sessions end in an upgrade, start at 0.05.

`priorStrength` is how much evidence it takes to move p. It is measured in the same pseudo-count units as signal weights, so with `priorStrength: 10` and a signal of weight 3, one signal is worth 3/10 of the prior. The table shows the evidence the quickstart config needs to fire at the default gate, and how many identical signals in quick succession that is. It is generated from [`evidenceToReveal`](/api/functions/evidenceToReveal) and checked by the test suite:

<!-- generated:priorStrength-table -->
| priorStrength | evidence needed | weight 3 | weight 2 | weight 1 |
| ------------- | --------------- | -------- | -------- | -------- |
| 5 | 8.9 | 3 | 5 | 9 |
| 10 | 15.1 | 6 | 8 | 16 |
| 20 | 26.5 | 9 | 14 | 27 |
| 50 | 58.2 | 20 | 30 | 59 |
<!-- /generated:priorStrength-table -->

A weak prior (small `priorStrength`) lets a few signals swing p; a strong one demands a lot of evidence. See the [Tuning guide](/guide/tuning) for how to choose.

## Uncertainty comes free

A Beta distribution also has a variance:

```
var = αβ / ((α + β)² (α + β + 1))
sd  = √var
```

With α = 0.5 and β = 9.5 the mean is 0.05 and sd ≈ 0.066. After six `pricing.viewed` signals, α = 18.5 and sd ≈ 0.088 while p ≈ 0.66. `shouldReveal` uses sd to demand that the *lower* end of the estimate clears the threshold, not just the mean; see [Reveal & confidence](/guide/concepts/reveal-and-confidence).

`evidence` in a [`Prediction`](/api/interfaces/Prediction) is α + β: the total pseudo-observations behind the estimate, prior included. It grows with every signal and shrinks back toward `priorStrength` as evidence decays.

## Several intents

Each intent has its own α, β, signals, learning record and cooldowns. The same event may be a signal of several intents with different weights, and an event may be the outcome of one intent and a signal of another. Episodes, however, are shared: one episode is open at a time for the whole state. See [Episodes & learning](/guide/concepts/episodes-and-learning).

## Reference

- [`IntentConfig`](/api/interfaces/IntentConfig), [`IntentState`](/api/interfaces/IntentState), [`createState`](/api/functions/createState).
