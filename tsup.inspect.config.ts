import { defineConfig } from 'tsup';

// `oracular/inspect`: the HTML renderer and the mount helper, built after the main entry for the
// same reason as presets. It imports nothing from the engine at run time: it renders the snapshot
// that `inspect` from the main entry returns.
export default defineConfig({
  entry: ['src/inspect.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2020',
  treeshake: true,
  splitting: false,
  minify: false,
});
