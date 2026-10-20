import type { IntentStore } from './store';

/** The part of React Native's `AppState` the helper uses. */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (status: string) => void): { remove(): void };
}

/**
 * Flushes the store's pending save whenever the app leaves the foreground, and retries the
 * stored state's read when it comes back (a no-op once it has loaded). React Native has no
 * `pagehide` or `visibilitychange`, so without this the hook only flushes on unmount. Pass
 * React Native's `AppState` in; the returned function removes the listener.
 *
 * @example
 * ```tsx
 * import { AppState } from 'react-native';
 *
 * useEffect(() => flushOnBackground(store, AppState), [store]);
 * ```
 */
export function flushOnBackground(
  store: Pick<IntentStore, 'flush' | 'load'>,
  appState: AppStateLike,
): () => void {
  const subscription = appState.addEventListener('change', (status) => {
    if (status === 'active') void store.load();
    else void store.flush();
  });
  return () => {
    subscription.remove();
  };
}
