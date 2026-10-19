import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // tsup builds every config at the same time; keep the other entries' output when cleaning dist/.
    clean: ['!cli.js', '!presets.*'],
    target: 'es2020',
    treeshake: true,
    splitting: false,
    minify: false,
  },
  {
    // `oracular/presets`, built apart from the main entry so that each declaration file is
    // self-contained: one shared dts build would split the types both entries use into a chunk with
    // a hashed name, and the tarball's file list is pinned. The few bytes of `ms` it uses are
    // bundled into it.
    entry: ['src/presets.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
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
