# The clickstream case study

Scripts behind [Case study: a public clickstream](https://yuribenjamin.github.io/oracular/guide/case-study-clickstream). They turn the Retailrocket e-commerce dataset into recorder logs, so that `oracular tune` and `oracular replay` can run on it, and run an app's view of the engine over the visitors who came back.

The data is not in this repository. Download `events.csv` from the dataset's page on Kaggle, <https://www.kaggle.com/datasets/retailrocket/ecommerce-dataset>. It is published under CC BY-NC-SA 4.0: credit the source, no commercial use of the data, and share any derived data under the same terms. Nothing here redistributes it; the scripts read your copy and the case study quotes aggregates.

```sh
node examples/retailrocket/convert.mjs path/to/events.csv out/
npx oracular tune out/fit.ndjson --config examples/retailrocket/start.config.json
# paste the printed config into out/tuned.config.json, then
npx oracular replay out/holdout.ndjson --config out/tuned.config.json
node examples/retailrocket/returning-buyers.mjs out/holdout.ndjson out/tuned.config.json
node examples/retailrocket/baseline-rules.mjs out/holdout.ndjson 1 2 3 3:2   # the hand-written rule (k, or k:N with memory), scored like replay
node examples/retailrocket/returning.mjs out/holdout.ndjson out/holdout-returning.ndjson   # visitors with three or more sessions
```

`convert.mjs`, `returning.mjs` and `baseline-rules.mjs` need only Node 18 or newer. The rest need `oracular` installed (`npm install oracular`), or this repository built (`npm run build`). Both CLI commands run on the 1.4 million record halves with Node's default heap, in well under a minute each.
