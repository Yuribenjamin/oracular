import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  treeshake: true,
  splitting: false,
  minify: false,
  // The declarations resolve `oracular` through node_modules, as a consumer does, never ../../src.
  tsconfig: 'tsconfig.build.json',
  // Peers stay imports: the app's React and the app's oracular, never a second copy.
  external: ['oracular', 'react', 'react/jsx-runtime', 'react-dom'],
});
