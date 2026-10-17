# Explainability

Every prediction can be taken apart. [`explain`](/api/functions/explain) returns one row per declared signal of an intent, strongest first.

```ts
explain(state, 'upgrade', Date.now());
```

After ten sessions in which `pricing.viewed` led to an upgrade six times out of seven and `export.clicked` appeared every time, whether or not the user upgraded, with two fresh signals an hour ago:

```ts
[
  { signal: 'pricing.viewed', contribution: 3.12, impact: 0.16, initialWeight: 3, learnedWeight: 3.78, effectiveWeight: 3.13, hits: 6, misses: 1 },
  { signal: 'limit.hit',      contribution: 2,    impact: 0.10, initialWeight: 2, learnedWeight: 0,    effectiveWeight: 2,    hits: 0, misses: 0 },
  { signal: 'export.clicked', contribution: 0,    impact: 0,    initialWeight: 1, learnedWeight: 0.67, effectiveWeight: 1,    hits: 7, misses: 3 },
]
```

## The fields

| field             | meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `contribution`    | signed pseudo-counts the signal currently holds after decay: positive in α, negative in β        |
| `impact`          | p minus what p would be without this signal's contribution                                       |
| `initialWeight`   | the weight in your config                                                                        |
| `learnedWeight`   | what this user's history alone says the weight should be; 0 until the signal has completed an episode |
| `effectiveWeight` | the blend that the next occurrence will actually add                                             |
| `hits`, `misses`  | the learned record, decayed if `learning.halfLife` is set                                        |

Rows are sorted by |impact| descending, then by name. Impact is nonlinear in p, so a +3 contribution can matter more than a −4 one depending on where p sits.

Two optional filters, both off by default: `nonZero` keeps only signals that currently hold evidence, and `limit` caps the number of rows after sorting.

```ts
explain(state, 'upgrade', Date.now(), { nonZero: true, limit: 3 }); // the three signals doing the most
```

If you also need the prediction and the reveal decision, [`evaluate`](/api/functions/evaluate) returns all three from a single decay pass and takes the same filters:

```ts
const { prediction, reveal, explanation } = evaluate(state, 'upgrade', Date.now(), { limit: 3 });
```

## Reading the example

- `limit.hit` has no history, so `learnedWeight` is 0 and `effectiveWeight` is exactly the initial 2.
- `pricing.viewed` was followed by an upgrade in six of its seven sessions, while the three sessions without it saw one upgrade: `qWith = 7/9`, `qWithout = 2/5`, a lift of 0.63 and a learned weight of 3.78. The contrast is 7 sessions against 3, `nEff = 2.1`, so blended with your 3 the effective weight is 3.13.
- `export.clicked` appeared in every session. `learnedWeight` shows what its 7-of-10 rate would say against an empty comparison set, but with no session without it there is no counterfactual, `nEff` is 0, and its effective weight stands at exactly the initial 1. Learning needs contrast; see [Episodes & learning](/guide/concepts/episodes-and-learning#learning-needs-contrast).

## Why it adds up

α is always α₀ plus the sum of the signals' α-contributions, and β likewise. The test suite asserts this within 1e-9 after every operation, so `explain` can never show you a picture that disagrees with `predict`.

## Uses

- **Tuning**: run your real event log through the engine in development and look at the rows before choosing weights. The [Tuning guide](/guide/tuning) shows how.
- **Debugging a reveal**: when something fires that shouldn't have, the top row tells you which signal did it and whether the weight was yours or learned.
- **A devtools panel**: the [Playground](/playground) is a small one; a richer version is on the [Roadmap](/guide/roadmap).

## Reference

- [`explain`](/api/functions/explain), [`ExplainOptions`](/api/interfaces/ExplainOptions), [`evaluate`](/api/functions/evaluate), [`SignalExplanation`](/api/interfaces/SignalExplanation).
