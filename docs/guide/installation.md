# Installation

::: code-group

```sh [npm]
npm install oracular
```

```sh [pnpm]
pnpm add oracular
```

```sh [yarn]
yarn add oracular
```

```sh [bun]
bun add oracular
```

:::

oracular has **zero runtime dependencies**. The ESM build is about 13 kB minified and 4.3 kB gzipped.

## Module formats

Both ESM and CommonJS are published, with type declarations for each, through a proper `exports` map:

```ts
// ESM / TypeScript / bundlers
import { createState, observe, shouldReveal } from 'oracular';
```

```js
// CommonJS
const { createState, observe, shouldReveal } = require('oracular');
```

## Runtimes

The source is compiled against the ES2020 standard library only, with no DOM or Node type definitions available to it, so it cannot accidentally depend on either. It runs unchanged in:

- **Browsers** with ES2020 support (all evergreen browsers).
- **Node.js 18 and newer.** CI runs the built output on Node 18, 20, 22 and 24.
- **React Native** (Hermes and JavaScriptCore). No polyfills needed.
- **Workers, edge runtimes, Deno, Bun**: anything that runs standard JavaScript.

The library never calls `Date.now()`, `setTimeout`, `fetch`, `localStorage`, `window`, `process` or any other global. You pass time in as a parameter and persist the state yourself; see [Persistence](/guide/persistence) and [Using with frameworks](/guide/frameworks).

## TypeScript

Types are included. The package is written in strict TypeScript with `exactOptionalPropertyTypes`, so optional fields are either present with a value or absent; passing an explicit `undefined` is accepted at runtime and dropped, but your own strict config may flag it. Import the types you need from the package root:

```ts
import type { EngineConfig, EngineState, Prediction, SignalExplanation } from 'oracular';
```

The full list is in the [API reference](/api/).

## Versioning

oracular follows semantic versioning. The serialized state carries its own [`STATE_VERSION`](/api/variables/STATE_VERSION), independent of the package version, and changes to it come with a documented migration path. See [Persistence & migration](/guide/persistence).
