import { defineConfig } from 'tsup';

// `oracular/presets`, built after the main entry (see the build script in package.json) so that its
// declaration files are self-contained and nothing else cleans them away: one shared dts build
// would split the types both entries use into a chunk with a hashed name, and two builds running
// at once raced over dist/ and lost presets.d.ts on a slow runner. The few bytes of `ms` it uses
// are bundled into it.
export default defineConfig({
  entry: ['src/presets.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2020',
  treeshake: true,
  splitting: false,
  minify: false,
});
