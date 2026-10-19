import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `npm run test:react18` installs React 18 into a scratch directory and names it here, so every
// React import in src and tests comes from that copy; react-dom finds the same `react` next to it.
const reactDir = process.env.ORACULAR_REACT_DIR;
const reactAliases =
  reactDir === undefined
    ? []
    : [
        { find: /^react$/, replacement: join(reactDir, 'react/index.js') },
        { find: /^react\/jsx-runtime$/, replacement: join(reactDir, 'react/jsx-runtime.js') },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: join(reactDir, 'react/jsx-dev-runtime.js'),
        },
        { find: /^react-dom$/, replacement: join(reactDir, 'react-dom/index.js') },
        { find: /^react-dom\/client$/, replacement: join(reactDir, 'react-dom/client.js') },
      ];

export default defineConfig({
  resolve: {
    alias: [
      ...reactAliases,
      // Tests run against the engine's source, as the root suite does, so they need no root build.
      {
        find: /^oracular$/,
        replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
      {
        find: /^oracular\/presets$/,
        replacement: fileURLToPath(new URL('../../src/presets.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
});
