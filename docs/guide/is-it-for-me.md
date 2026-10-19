# Is oracular for you?

Five questions. Each has a yes that fits and a no that points somewhere better, so the answer takes a minute rather than an evaluation.

## 1. Do you want to act on one user, or report on all of them?

oracular answers "is *this* user ready?" inside the app, with a probability, a confidence bound and the reasons, and it aggregates nothing. If what you need is a dashboard, a funnel or a population model, that is analytics, and oracular has no server to put it on. If you need both, they coexist: analytics counts what happened, oracular decides what to show next. See [What it isn't](/guide/introduction#what-it-isnt).

## 2. Can you name the events, and the outcome?

The engine learns only from events your app already emits: a few that hint at the intent, the signals, and one that confirms it, the outcome. Without an outcome there is nothing to learn from, and oracular is a gate with a confidence bound over your weights, useful but not adaptive. With one, every session teaches it something. [Signals & weights](/guide/concepts/signals-and-weights) and [What it can and cannot learn](/guide/can-and-cannot-learn) say what counts.

## 3. Does the intent build over time?

Interest in a paid plan grows over days, being stuck grows over minutes, a purchase builds within a session. All three fit, because the half-life is yours to set, from minutes to months. What does not fit is a one-shot classification with no history, such as "is this message spam", or an outcome that happens once per user and never again, where learning has nothing to correct; see [Once-per-user outcomes](/guide/can-and-cannot-learn#once-per-user-outcomes-your-priors-do-the-work).

## 4. Is per-user learning enough, or do you need a model trained across users?

On the device, the engine sees one user's history. On the [public clickstream](/guide/case-study-clickstream), 87% of visitors had a single session, and for them the tuned gate *is* the rule a skeptic would write: the two land within half a point of each other on precision and recall. Among the visitors with three or more sessions the printed config caught 43% more orders than the rule at 3.3 points more precision, and with two learning constants fit on the other half of the data it caught 27.9% of the orders at 48.9% precision, where the best hand-written rule caught 6.4% at 39.2%. If your users come back, learning pays; if most never return, you are shipping the population's config, which `tune` fits from a shadow log, and that is fine too. A model trained on data you would have to collect will beat both on precision, and collecting it is the thing oracular exists to avoid.

## 5. Will your app own time and storage?

Every call takes a timestamp and the state is a JSON object you persist. `@oracular/react` does both for React apps; elsewhere it is two lines around `serialize` and `deserialize` ([Persistence](/guide/persistence)). If you want a service that stores and schedules for you, this is not it.

## If the answers are mostly yes

Start from a [preset](/guide/presets), run it in [shadow mode](/guide/shadow-mode) for a few weeks, let `tune` write the config from what the engine counted, and switch the reveal on. The [quickstart](/guide/quickstart) is fifteen lines, and the [playground](/playground) runs the engine in your browser with nothing installed. If you have a hand-written rule today, [Migrating from rules](/guide/migrating-from-rules) walks the same path with the numbers it produced once.
