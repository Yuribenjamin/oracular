# Explainability

Every prediction can be taken apart. [`explain`](/api/functions/explain) returns one row per declared signal of an intent, strongest first.

```ts
explain(state, 'upgrade', Date.now());
```

After ten sessions in which `pricing.viewed` led to an upgrade six times out of seven and `export.clicked` appeared every time, whether or not the user upgraded, with two fresh signals an hour ago:

```ts
[
  { signal: 'pricing.viewed', contribution: 3.31, impact: 0.17, initialWeight: 3, learnedWeight: 3.78, effectiveWeight: 3.32, hits: 6, misses: 1 },
  { signal: 'limit.hit',      contribution: 2,    impact: 0.09, initialWeight: 2, learnedWeight: 0,    effectiveWeight: 2,    hits: 0, misses: 0 },
  { signal: 'export.clicked', contribution: 0,    impact: 0,    initialWeight: 1, learnedWeight: 0.67, effectiveWeight: 0.83, hits: 7, misses: 3 },
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
- `pricing.viewed` was followed by an upgrade in six of its seven sessions, while the three sessions without it saw one upgrade: `qWith = 7/9`, `qWithout = 2/5`, a lift of 0.63 and a learned weight of 3.78. Blended with your 3 over seven episodes, the effective weight is 3.32.
- `export.clicked` appeared in every session, so there are no sessions without it to compare against. The comparison then falls back to an uninformative 50%, and its 7-of-10 rate reads as mildly positive (learned 0.67, effective 0.83). Always-present signals are the known weak spot of the contrast; see [Episodes & learning](/guide/concepts/episodes-and-learning#signals-present-in-every-episode).

## Why it adds up

α is always α₀ plus the sum of the signals' α-contributions, and β likewise. The test suite asserts this within 1e-9 after every operation, so `explain` can never show you a picture that disagrees with `predict`.

## Uses

- **Tuning**: run your real event log through the engine in development and look at the rows before choosing weights. The [Tuning guide](/guide/tuning) shows how.
- **Debugging a reveal**: when something fires that shouldn't have, the top row tells you which signal did it and whether the weight was yours or learned.
- **A devtools panel**: the [Playground](/playground) is a small one; a richer version is on the [Roadmap](/guide/roadmap).

## Reference

- [`explain`](/api/functions/explain), [`ExplainOptions`](/api/interfaces/ExplainOptions), [`evaluate`](/api/functions/evaluate), [`SignalExplanation`](/api/interfaces/SignalExplanation).
