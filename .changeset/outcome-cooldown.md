---
"oracular": minor
---

**A cooldown of its own after the outcome.** The outcome event paused reveals for the reveal `cooldown`: after a "stuck" intent's outcome, help was suppressed for the hour the cooldown named, and the next attempt that went wrong, exactly when the help should be back, got nothing; the only way out, `cooldown: 0`, disabled the reveal cooldown too. `reveal.outcomeCooldown` is the pause after the outcome, resolved per call → intent → engine like the other reveal options, 0 allowed; it defaults to the resolved `cooldown`, so nothing moves unless it is set. The JSON Schema lists it. Found by the second production integration.

**Rollback.** A stored config that sets `outcomeCooldown` loads in 0.13 and later, which do not read the stored snapshot when the app passes its config; 0.12 and earlier throw a `TypeError` on the unknown key, so remove it from the saved config before rolling a deploy back that far. The state version is unchanged.
