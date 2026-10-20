# Shadow mode

Before an intent changes what users see, measure it. In shadow mode your app runs oracular exactly as it would in production and records what the engine decides, but shows nothing. You export the log, replay it offline against the config you shipped or a new one, read precision, recall and calibration, let `tune` propose a config from it, and only then switch the reveal on.

Both production integrations so far built this themselves. From 0.3 the recorder format is part of oracular, so the tooling can rely on it.

## The workflow

1. **Create an install id once.** A random id, generated on first use and stored by your app:

   ```ts
   let installId = localStorage.getItem('oracular.install');
   if (installId === null) {
     installId = crypto.randomUUID();
     localStorage.setItem('oracular.install', installId);
   }
   const recording = { installId, mode: 'shadow' } as const;
   ```

   It exists so that records from one install can be grouped across exports, and for nothing else. It is **not** a fingerprint: never derive it from the device, the browser, the account or anything else about the user, and never join it with other identifiers. oracular never generates it, because the core has no randomness.

2. **Record every event and every episode end.** Right after `observe`, and right after `endEpisode`:

   ```ts
   import { createEndRecord, createRecord, endEpisode, markRevealed, observe, shouldReveal } from 'oracular';

   function track(name: string) {
     const event = { name, at: Date.now() };
     state = observe(state, event);
     log.append(JSON.stringify(createRecord(state, event, recording)));

     if (shouldReveal(state, 'upgrade', event.at)) {
       // Shadow: show nothing, but start the cooldown as if you had, so the
       // recorded decisions match what a live app would do next.
       state = markRevealed(state, 'upgrade', event.at);
     }
   }

   function endSession() {
     const at = Date.now();
     state = endEpisode(state, at);
     log.append(JSON.stringify(createEndRecord(at, recording)));
   }
   ```

   Each record is one line of JSON (NDJSON). Episodes that close through `episodeTimeout` need no record; replay applies the timeout itself.

3. **Store and export the log yourself.** oracular does no I/O, so where the log lives (IndexedDB, a file, an append-only table) and how it leaves the device are your decisions. The log holds event names and timestamps for one install. Treat it as behavioural data: export it only with the user's consent and under your own privacy policy. Cap its size; a rolling window of a few weeks is plenty.

4. **Replay it** against the config you are evaluating ([below](#replay)) and adjust weights, half-life and threshold until the numbers support acting.

5. **Go live** by switching `mode` to `'live'` and showing the reveal where you called `markRevealed`. Keep recording: the log then shows what shipped. But replay's precision on a live period is no longer an honest measurement, because the reveal itself causes outcomes.

## Replay

`npx oracular replay` reads one or more logs and a config, replays every install's events through the engine under that config, and reports per intent and per threshold:

```sh
npx oracular replay shadow-week-1.ndjson shadow-week-2.ndjson --config oracular.config.json
```

The config can be a `.json` file, or a `.js`, `.mjs` or `.cjs` module whose default (or `config`) export is the config. A `.json` file may carry a top-level `$schema` key pointing at the [published schema](https://yuribenjamin.github.io/oracular/config.schema.json) for editor completion; replay drops it before handing the config to the engine. On the fixture log in the repository, restricted to one intent and three thresholds:

```sh
npx oracular replay tests/fixtures/replay/shadow.ndjson --config tests/fixtures/replay/config.json \
  --intent upgrade --thresholds 0.3,0.5,0.7
```

<!-- replay:example -->
```text
oracular replay: 3 installs, 59 records (59 shadow, 0 live), 2023-11-15 07:15 UTC to 2023-11-27 07:15 UTC
Scored: shadow periods only. Durations assume `at` is in milliseconds.

upgrade: outcome upgrade.completed, window 7d (the intent's reveal cooldown), 3 installs

| threshold | reveals | per user | precision | recall      | median lead time |
| --------- | ------- | -------- | --------- | ----------- | ---------------- |
| 0.3       | 2       | 0.67     | 50.0%     | 100.0% of 1 | 4d               |
| 0.5 *     | 1       | 0.33     | 100.0%    | 100.0% of 1 | 1d               |
| 0.7       | 0       | 0.00     | –         | 0.0% of 1   | –                |
* the threshold your config resolves for this intent.

Reliability: p after every event except the outcome, against "the outcome follows within 7d".
| p       | points | mean p | observed |
| ------- | ------ | ------ | -------- |
| 0.0–0.1 | 10     | 0.050  | 0.0%     |
| 0.2–0.3 | 2      | 0.269  | 50.0%    |
| 0.3–0.4 | 2      | 0.344  | 50.0%    |
| 0.4–0.5 | 10     | 0.476  | 80.0%    |
| 0.5–0.6 | 5      | 0.565  | 40.0%    |
| 0.6–0.7 | 6      | 0.639  | 100.0%   |
Brier score 0.166 over 35 points (always predicting the base rate of 51.4%: 0.250). Lower is better. 15 points too close to the end of the log are not scored.
```
<!-- /replay:example -->

That output is checked by the test suite against the command itself. What the columns mean:

- **Replay.** Each install starts from `createState(config)` at its first record; anything it learned before the log began is not known. For every threshold the replay follows the policy of the guide above: whenever `shouldReveal` is true after an event, that is a reveal, and `markRevealed` starts the cooldown. `end` records call `endEpisode`; `episodeTimeout` closes idle episodes as on the device.
- **Window.** How long after a reveal an outcome still counts for it: the intent's reveal cooldown unless you pass `--window` (`3d`, `12h`, `90m`; durations with a unit assume `at` is in milliseconds). An intent with a cooldown of 0 is scored over its half-life instead, and the report says so.
- **Precision.** Reveals followed by the intent's outcome within the window, out of all reveals.
- **Recall.** Outcomes preceded by a reveal within the window, out of all outcomes.
- **Median lead time.** For the correct reveals, the time from the reveal to the outcome: how much notice the reveal gives.
- **Per user.** Reveals divided by installs: how often a user would see it.
- **Reliability.** After every event (except the outcome itself), the engine's p against whether the outcome followed within the window, in ten bins. A calibrated intent has *observed* close to *mean p* in every row. The **Brier score** is the mean of (p − outcome)²; it is compared with always predicting the base rate, which a useful intent must beat.
- **Censoring.** A reveal or point whose window runs past the end of the log cannot be judged yet, so it is left out and counted, never scored as a miss. The start of a log is not censored: every install begins from `createState(config)`, so an outcome within the first window of an install's records usually counts as a miss. Replay cannot tell a new install from a log that began after the user's history did, so read recall over the first days of a log with that in mind.

The `*` marks the threshold your config resolves for the intent. `--json` prints the same report as JSON for your own tooling.

### Shadow and live

Replay's numbers mean something only where reveals were not shown. Once a reveal is live it causes outcomes (the user upgrades because you offered), and precision measures your offer, not the engine. So:

- A log with both modes gets a **warning**, and only shadow periods are scored: a reveal, point or outcome whose window touches a live record of the same install is left out.
- A log with nothing but live records is **refused** (exit code 1).
- `--include-live` scores everything, with a warning that live periods overstate the engine.

Exit codes: 0 when the report is printed, 1 for unreadable input or nothing to score, 2 for a usage error.

## Tune

`npx oracular tune` reads the same log and seeds a config from it. Grouped by install, it reads what the engine itself counts, hits, misses and episode totals, off the state after every record, so it cannot disagree with what a device would learn from the same events:

- **prior**: the pooled base rate, `(outcomes + 1) / (episodes + 2)`.
- **priorStrength**: from the spread of per-install base rates, by the method of moments on a Beta distribution once the spread that sampling alone would produce is taken out, kept inside 2 to 50. Below 10 installs with a counted episode it is kept as it was, and the report says so.
- **weights**: for each declared signal, `priorStrength × score`, where score is the engine's signed, bounded comparison of outcome rates ([Episodes & learning](/guide/concepts/episodes-and-learning#from-hits-and-misses-to-a-weight)). With the default normalized difference, score equals lift. Other measures are converted before weighting; the report includes the raw lift separately. A 90% Wilson interval on the rate with the signal is transformed through the same score to give the interval on the weight. A weight is labelled *thin* while its contrast is below `learning.priorEpisodes`, the point at which the engine itself would trust the comparison as much as your guess. A signal with no measurable association is left out of the printed config.
- **ubiquitous signals**: a signal seen in more than 90% of counted episodes is left out too, whatever its lift, and the report says so. It cannot tell episodes apart, and the few episodes without it are rarely typical sessions: a checkout that opens a session of its own, a stub with one event. The contrast measured on them says little about the signal and a lot about those sessions. On a real clickstream, `item.viewed` sat in 99% of sessions and the 1% without it ended in a purchase two times in three, which made the contrast call views strongly negative; dropping the signal scored better than either that weight or the hand-written one.
- **halfLife**: the lowest Brier score over a grid of half-lives, each scored by `replay` with the fitted prior, strength and weights and one fixed window. When the best point improves on the current value by less than 1%, the grid is flat for this log and the current value is kept; the report says so and prints the grid to four decimals so you can see the shape yourself.
- **the base rate check**: when the fitted intent, at its chosen half-life, does not score better than always predicting its base rate, the report says so under the grid. Its signals do not separate the episodes that end with the outcome from the rest, or no signal is left; drop the intent or find signals that do.

```sh
npx oracular tune shadow-week-1.ndjson shadow-week-2.ndjson --config oracular.config.json
```

Options: `--intent <name>` to fit some intents only; `--half-lives 12h,1d,3d` for the grid (default 1h, 6h, 1d, 3d, 7d, 14d, 30d plus the current value); `--window` to override the scoring window (by default the intent's reveal cooldown, or its half-life when the cooldown is 0); `--all-events` to measure every other event name in the log as a candidate signal; `--include-live`; `--json`. On the fixture log in the repository, restricted to the `stuck` intent:

```sh
npx oracular tune tests/fixtures/replay/shadow.ndjson --config tests/fixtures/replay/config.json --intent stuck
```

<!-- tune:example -->
```text
oracular tune: 3 installs, 59 records (59 shadow, 0 live), 2023-11-15 07:15 UTC to 2023-11-27 07:15 UTC
Counted: shadow episodes only. Durations assume `at` is in milliseconds. Every number is a starting point: the engine corrects the weights per user.

stuck: outcome help.article.read, 3 installs, 14 counted episodes, 2 with the outcome

| knob          | fitted | was | from                                                                               |
| ------------- | ------ | --- | ---------------------------------------------------------------------------------- |
| prior         | 0.1875 | 0.1 | 2 of 14 episodes ended with the outcome, smoothed (2+1)/(14+2)                     |
| priorStrength | 5.0    | 5.0 | kept: 3 installs with a counted episode, reading the spread needs 10               |
| halfLife      | 10m    | 10m | lowest Brier score over the grid, 0.1581 (always predicting the base rate: 0.2001) |

| signal         | weight | was   | 90% interval  | lift  | with: hits / misses | without: outcomes / episodes | note                     |
| -------------- | ------ | ----- | ------------- | ----- | ------------------- | ---------------------------- | ------------------------ |
| editor.undo    | 1.83   | 1.00  | 0.81 to 4.07  | +0.37 | 2 / 2               | 0 / 10                       | thin: 2.9 of 10 contrast |
| search.empty   | 2.22   | 2.00  | 1.18 to 4.60  | +0.44 | 2 / 1               | 0 / 11                       | thin: 2.4 of 10 contrast |
| help.opened    | 2.81   | 3.00  | 2.07 to 5.00  | +0.56 | 2 / 0               | 0 / 12                       | thin: 1.7 of 10 contrast |
| task.completed | -1.87  | -4.00 | -5.00 to 3.41 | -0.38 | 0 / 1               | 2 / 13                       | thin: 0.9 of 10 contrast |

Half-life grid, Brier score against "the outcome follows within 1h" (lower is better): 10m 0.1581 *, 1h 0.1613, 6h 0.1619, 1d 0.1636, 3d 0.1679, 7d 0.1701, 14d 0.1710, 30d 0.1715

Config with every fitted value swapped in (paste it, or pass it to oracular replay --config):
{
  "intents": {
    "upgrade": {
      "prior": 0.05,
      "priorStrength": 10,
      "halfLife": 604800000,
      "signals": {
        "pricing.viewed": 3,
        "limit.hit": 2,
        "export.clicked": 1,
        "plan.downgraded": -4
      },
      "outcome": "upgrade.completed"
    },
    "stuck": {
      "prior": 0.1875,
      "priorStrength": 5,
      "halfLife": 600000,
      "signals": {
        "editor.undo": 1.83,
        "search.empty": 2.22,
        "help.opened": 2.81,
        "task.completed": -1.87
      },
      "outcome": "help.article.read",
      "saturate": false,
      "reveal": {
        "threshold": 0.6,
        "cooldown": 3600000
      }
    },
    "tip": {
      "prior": 0.2,
      "priorStrength": 5,
      "halfLife": 86400000,
      "signals": {
        "app.opened": 1
      }
    }
  },
  "episodeTimeout": 1800000
}
```
<!-- /tune:example -->

That output is checked by the test suite against the command itself. Three installs and fourteen episodes are far too little, and the report says so: every weight is thin, the prior strength is kept, and a warning on stderr says to treat every number as a rough starting point. `task.completed` flips from −4 to +0.83 on the strength of a single episode, and its interval, −5 to 3.31, says the data does not know. Read a real log the same way: trust a weight whose interval excludes 0 and that is not thin, and keep your own number otherwise.

What tune counts, and what it leaves out:

- **Counted episodes.** Each install starts from `createState(config)` at its first record, as in replay. An episode counts once its verdict is known: the outcome arrived, or it ended through an `end` record or `episodeTimeout`. The open last episode of every install is not counted.
- **Shadow only.** An episode in which any record was live is left out, because the reveal may have caused the outcome. A mixed log gets a warning, a live-only log is refused, and `--include-live` counts everything anyway.
- **Candidates.** With `--all-events`, every other event name in the log is measured as if it were a signal of weight 1, which changes nothing about what the declared signals learn. Candidates are listed, never written into the config: a signal that fires together with one you have is one piece of evidence configured as two ([signals add](/guide/can-and-cannot-learn#signals-add-no-order-no-interactions)).
- **Attribution.** Tune counts each episode's own verdict, with `attribution` switched off while counting: the window is a rule for the device's learner, and the weights tune fits are the prior that learner starts from. The half-life grid keeps it on, since `replay` scores what the device would predict.
- **What stays.** Everything tune cannot read from the log is kept as it was: `episodeTimeout`, `reveal`, `learning`, `resetOnOutcome`, `saturate`, `attribution`, and intents without an outcome. The printed config is the config you gave it with the fitted values swapped in, and `replay --config` takes it as it is.

Exit codes as replay: 0 when the report is printed, 1 for unreadable input or nothing to fit, 2 for a usage error.

## The record format

Version 1, the `v` field of every record and the exported [`RECORD_VERSION`](/api/variables/RECORD_VERSION). One JSON object per line. Two kinds:

**`event`**, written by [`createRecord(state, event, options)`](/api/functions/createRecord):

```json
{"v":1,"kind":"event","installId":"a3f0c2e1-…","mode":"shadow","event":{"name":"pricing.viewed","at":1700000000000},"decisions":{"upgrade":{"p":0.269,"lower":0.117,"shouldReveal":false,"suppressedUntil":null,"top":[{"signal":"pricing.viewed","impact":0.219}],"weights":{"pricing.viewed":3,"limit.hit":2,"export.clicked":1}}}}
```

Numbers are shortened here; records carry full precision.

| field | meaning |
| ----- | ------- |
| `v` | format version, 1 |
| `kind` | `"event"` |
| `installId` | the app's random install id |
| `mode` | `"shadow"` while reveals are computed but not shown, `"live"` once they are shown |
| `event.name`, `event.at` | the observed event. `props` are never recorded |
| `decisions` | one entry per declared intent: what the engine decided right after the event |
| `decisions[i].p`, `.lower` | the Beta mean and its lower confidence bound, as [`predict`](/api/functions/predict) |
| `decisions[i].shouldReveal` | what [`shouldReveal`](/api/functions/shouldReveal) returned with the state's own reveal options |
| `decisions[i].suppressedUntil` | when the running cooldown ends, or null |
| `decisions[i].top` | the signals holding evidence, largest impact first, at most `options.top` (default 3) |
| `decisions[i].weights` | the effective weight of every declared signal |

**`end`**, written by [`createEndRecord(at, options)`](/api/functions/createEndRecord) whenever the app calls `endEpisode`:

```json
{"v":1,"kind":"end","installId":"a3f0c2e1-…","mode":"shadow","at":1700000600000}
```

The **event** is the input: replay recomputes everything from `event.name`, `event.at` and the `end` records, under whatever config you give it. The **decisions** are a record of what shipped, so you can compare it with what a new config would have done. They are never read as input.

Compatibility: a new optional field does not change `v`, readers ignore fields they do not know and skip records of a `kind` they do not know, and anything that a version 1 reader could misread bumps `v`.

## Reference

- [`createRecord`](/api/functions/createRecord), [`createEndRecord`](/api/functions/createEndRecord), [`RECORD_VERSION`](/api/variables/RECORD_VERSION), [`EventRecord`](/api/interfaces/EventRecord), [`EndRecord`](/api/interfaces/EndRecord), [`RecordedDecision`](/api/interfaces/RecordedDecision), [`RecordOptions`](/api/interfaces/RecordOptions).
