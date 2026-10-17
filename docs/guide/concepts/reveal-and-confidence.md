# Reveal & confidence

A probability is not enough to act on. Three signals can put p at 0.5 while the estimate is still so vague that the true value could easily be 0.3. [`shouldReveal`](/api/functions/shouldReveal) therefore asks two questions, and both must be yes.

## The rule

```
sd    = √( αβ / ((α + β)² (α + β + 1)) )
lower = p − z · sd                                  clamped to [0, 1]

shouldReveal = p ≥ threshold
           and lower ≥ threshold
           and no cooldown is running
```

`z` defaults to 1.28, which under the normal approximation makes `lower` a one-sided 90% bound: you are about 90% sure the true probability is at least `lower`. `threshold` defaults to 0.5.

From the [Signals & weights](/guide/concepts/signals-and-weights) table: p crosses 0.5 at the third `pricing.viewed`, but `lower` only reaches 0.5 at the sixth. The three extra signals buy the confidence.

## Threshold and z together

Evidence the quickstart config needs, and how many `pricing.viewed` (+3) signals that is. The table is generated from [`evidenceToReveal`](/api/functions/evidenceToReveal) and checked by the test suite:

<!-- generated:threshold-z-table -->
| threshold | z | evidence needed | signals of weight 3 |
| --------- | ---- | --------------- | ------------------- |
| 0.3 | 1.28 | 7.2 | 3 |
| 0.5 | 0 | 9.0 | 3 |
| 0.5 | 1.28 | 15.1 | 6 |
| 0.5 | 1.64 | 17.0 | 6 |
| 0.5 | 2 | 18.9 | 7 |
| 0.7 | 1.28 | 33.1 | 12 |
| 0.9 | 1.28 | 122.9 | 41 |
<!-- /generated:threshold-z-table -->

`z = 0` turns the confidence requirement off and fires on the mean alone. `z = 1.64` is a one-sided 95% bound, `z = 2.33` about 99%. Raising `threshold` is far more expensive than raising `z`, because evidence has to push p itself, not just tighten it.

## Where options come from

`threshold`, `z` and `cooldown` are resolved per call → intent → engine → defaults:

```ts
const config = {
  reveal: { z: 1.64 },                                   // engine default
  intents: {
    upgrade: { /* … */ reveal: { threshold: 0.6 } },     // intent default
  },
};

shouldReveal(state, 'upgrade', now);                     // threshold 0.6, z 1.64
shouldReveal(state, 'upgrade', now, { threshold: 0.8 }); // threshold 0.8, z 1.64
```

## Cooldowns

After you call [`markRevealed`](/api/functions/markRevealed), and after the intent's outcome event, a cooldown runs for `cooldown` (default: the intent's `halfLife`) during which `shouldReveal` is false regardless of the evidence. [`predict`](/api/functions/predict) reports `revealed` (inside a reveal cooldown) and `suppressedUntil` (when the later of the running cooldowns ends, or null). Details on [Outcomes & cooldowns](/guide/concepts/outcomes-and-cooldowns).

## The full shape

Everything `predict` returns, so you can see where `lower` and the cooldown fields sit:

```ts
interface Prediction {
  intent: string;
  p: number;                        // α / (α + β)
  sd: number;                       // Beta standard deviation
  lower: number;                    // p − z·sd, clamped to [0, 1]; what shouldReveal tests
  confidence: number;               // 1 − 2·sd, clamped to [0, 1]; a heuristic
  evidence: number;                 // α + β, prior strength included
  revealed: boolean;                // inside the cooldown after markRevealed
  revealedAt: number | null;
  suppressedUntil: number | null;   // end of the later running cooldown, or null
}
```

[`evaluate`](/api/functions/evaluate) returns this as `prediction`, together with the `reveal` boolean and the `explanation` rows, from one decay pass.

## `confidence`

`predict` also returns `confidence = 1 − 2·sd`, clamped to [0, 1]. It is a **heuristic** for dashboards and debugging: 1 means a sharp estimate, 0 means as vague as a Beta gets (sd = 0.5). Because sd is largest near p = 0.5, `confidence` can *drop* when evidence moves p from 0.05 toward 0.5 even though more is known. `lower` is what the engine decides with; `confidence` is for humans.

## Reference

- [`RevealOptions`](/api/interfaces/RevealOptions), [`Prediction`](/api/interfaces/Prediction), [`shouldReveal`](/api/functions/shouldReveal), [`predict`](/api/functions/predict).
