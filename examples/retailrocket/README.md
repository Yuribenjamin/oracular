# The clickstream case study

Scripts behind [Case study: a public clickstream](https://yuribenjamin.github.io/oracular/guide/case-study-clickstream). They turn the Retailrocket e-commerce dataset into recorder logs, so that `oracular tune` and `oracular replay` can run on it, and run an app's view of the engine over the visitors who came back.

The data is not in this repository. Download `events.csv` from the dataset's page on Kaggle, <https://www.kaggle.com/datasets/retailrocket/ecommerce-dataset>, and keep its licence terms; nothing here redistributes it.

```sh
node examples/retailrocket/convert.mjs path/to/events.csv out/
npx oracular tune out/fit.ndjson --config examples/retailrocket/start.config.json
# paste the printed config into out/tuned.config.json, then
npx oracular replay out/holdout.ndjson --config out/tuned.config.json
node examples/retailrocket/returning-buyers.mjs out/holdout.ndjson out/tuned.config.json
```

`convert.mjs` needs only Node 18 or newer. The other two need `oracular` installed (`npm install oracular`), or this repository built (`npm run build`). Both CLI commands run on the 1.4 million record halves with Node's default heap, in well under a minute each.
