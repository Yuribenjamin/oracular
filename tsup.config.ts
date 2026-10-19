import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // This file's two configs build at the same time; keep the bin's output when cleaning dist/.
    // The subpaths (tsup.presets.config.ts, tsup.inspect.config.ts) build afterwards, in turn.
    clean: ['!cli.js'],
    target: 'es2020',
    treeshake: true,
    splitting: false,
    minify: false,
  },
  {
    // The `oracular` bin. It imports 'oracular' like any user does, resolved at run time through
    // the package's own exports map, so the engine is not bundled into it twice.
    entry: { cli: 'cli/main.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    external: ['oracular'],
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    minify: false,
  },
]);
