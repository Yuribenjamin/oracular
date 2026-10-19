import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  // @oracular/react is linked from the workspace: resolve React from this app, so there is one copy.
  resolve: { dedupe: ['react', 'react-dom'] },
});
