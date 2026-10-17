# Outcomes & cooldowns

The outcome event is the moment the intent stops being a prediction and becomes a fact. oracular does three things with it.

## 1. It learns

Every signal seen in the episode gets a hit and the episode counts toward the base rate, as described in [Episodes & learning](/guide/concepts/episodes-and-learning).

## 2. It resets the slate

By default (`resetOnOutcome: true`) the intent's evidence returns to the prior: α and β go back to α₀ and β₀ and the per-signal contributions are cleared. The user already upgraded; stop predicting that they will.

What survives the reset: everything learned (`learned`, the base-rate counters), `lastRevealedAt`, `revealCount`, and the new `lastOutcomeAt`.

Set `resetOnOutcome: false` for intents whose outcome can repeat within one episode, such as *adds another item to the cart*, where evidence should keep accumulating.

## 3. It pauses reveals

The outcome starts the intent's **cooldown**: for `cooldown` after `lastOutcomeAt`, `shouldReveal` is false however strong the fresh evidence. A user who just bought is not immediately pitched again.

The same cooldown runs after [`markRevealed`](/api/functions/markRevealed), so you don't fire on every event once you've shown something.

```
revealed        = now < lastRevealedAt + cooldown
suppressed      = revealed  or  now < lastOutcomeAt + cooldown
suppressedUntil = the later of the two running cooldown ends, or null
```

`cooldown` defaults to the intent's `halfLife`; set it per intent or per call through [`RevealOptions`](/api/interfaces/RevealOptions). A cooldown of 0 disables both.

## Timeline

Quickstart config with `halfLife` and therefore `cooldown` of one week:

```
Mon 09:00  pricing.viewed ×6      p 0.66, lower 0.55       shouldReveal → true
Mon 09:01  markRevealed           revealed, suppressedUntil = next Mon 09:01
Mon 09:30  upgrade.completed      hits for pricing.viewed; α, β reset to prior;
                                  lastOutcomeAt set; suppressedUntil = next Mon 09:30
Tue        pricing.viewed ×6      p 0.66 again, but shouldReveal → false (suppressed)
next Mon 09:30                    suppression ends; shouldReveal depends on evidence again
```

## Reading it

[`predict`](/api/functions/predict) returns:

| field             | meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `revealed`        | true while inside the cooldown that follows `markRevealed`           |
| `revealedAt`      | time of the last `markRevealed`, or null                             |
| `suppressedUntil` | when the later running cooldown ends; null when `shouldReveal` is free to fire |

`shouldReveal` is exactly `suppressedUntil === null && p ≥ threshold && lower ≥ threshold`. If you want to schedule a re-check, `suppressedUntil` is the time to use.

## Reference

- [`IntentConfig.resetOnOutcome`](/api/interfaces/IntentConfig), [`IntentState`](/api/interfaces/IntentState) (`lastOutcomeAt`, `lastRevealedAt`, `revealCount`), [`Prediction`](/api/interfaces/Prediction).
