import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests and examples import from 'oracular' and 'oracular/presets' exactly as users do.
    alias: [
      {
        find: /^oracular$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^oracular\/presets$/,
        replacement: fileURLToPath(new URL('./src/presets.ts', import.meta.url)),
      },
      {
        find: /^oracular\/inspect$/,
        replacement: fileURLToPath(new URL('./src/inspect.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
