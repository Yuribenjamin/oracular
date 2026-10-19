import { createIntentStore, localStorageAdapter } from '@oracular/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { demoFromUrl } from './demo';
import { config } from './intent-config';

// One store for the whole app, persisted in localStorage; the hook loads it on mount. With `?demo`
// in the URL the store runs on a virtual clock and persists nothing (see demo.ts); that is how the
// inspector recording in the repository's README is made.
const demo = demoFromUrl();
const store =
  demo === null
    ? createIntentStore(config, { persist: localStorageAdapter('oracular-example') })
    : createIntentStore(config, { now: demo.now });
if (demo !== null) window.oracularDemo = demo;

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App store={store} demo={demo} />
    </StrictMode>,
  );
}
