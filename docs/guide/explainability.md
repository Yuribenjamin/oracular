# Explainability

Every prediction can be taken apart. [`explain`](/api/functions/explain) returns one row per declared signal of an intent, strongest first.

```ts
explain(state, 'upgrade', Date.now());
```

After ten sessions in which `pricing.viewed` led to an upgrade six times out of seven and `export.clicked` appeared every time, whether or not the user upgraded, with two fresh signals an hour ago:

```ts
[
  { signal: 'pricing.viewed', contribution: 2.58, impact: 0.14, initialWeight: 3, learnedWeight: 2, effectiveWeight: 2.59, hits: 6, misses: 1 },
  { signal: 'limit.hit',      contribution: 2,    impact: 0.10, initialWeight: 2, learnedWeight: 0, effectiveWeight: 2,    hits: 0, misses: 0 },
  { signal: 'export.clicked', contribution: 0,    impact: 0,    initialWeight: 1, learnedWeight: 0, effectiveWeight: 0.5,  hits: 7, misses: 3 },
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

## Reading the example

- `limit.hit` has no history, so `learnedWeight` is 0 and `effectiveWeight` is exactly the initial 2.
- `export.clicked` was followed by an upgrade exactly as often as any session was (7 of 10 is also the base rate), so the history says it carries no information. Its learned weight is 0 and the blend is pulling the effective weight toward 0: `(10 × 1 + 10 × 0) / 20 = 0.5`.
- `pricing.viewed` beat the base rate, so it learned a positive weight. The blend is still just below the initial 3 only because your guess was higher than seven episodes can yet support.

## Why it adds up

α is always α₀ plus the sum of the signals' α-contributions, and β likewise. The test suite asserts this within 1e-9 after every operation, so `explain` can never show you a picture that disagrees with `predict`.

## Uses

- **Tuning**: run your real event log through the engine in development and look at the rows before choosing weights. The [Tuning guide](/guide/tuning) shows how.
- **Debugging a reveal**: when something fires that shouldn't have, the top row tells you which signal did it and whether the weight was yours or learned.
- **A devtools panel**: the [Playground](/playground) is a small one; a richer version is on the [Roadmap](/guide/roadmap).

## Reference

- [`explain`](/api/functions/explain), [`SignalExplanation`](/api/interfaces/SignalExplanation).
