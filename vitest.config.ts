import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests and examples import from 'oracular' exactly as users do.
    alias: { oracular: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
