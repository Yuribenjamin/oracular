import { createIntentStore, localStorageAdapter } from '@oracular/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { config } from './intent-config';

// One store for the whole app, persisted in localStorage; the hook loads it on mount.
const store = createIntentStore(config, { persist: localStorageAdapter('oracular-example') });

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
}
