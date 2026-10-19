/**
 * Where the serialized state lives between sessions. `load` returns the string a previous `save`
 * wrote, or null the first time; both may be synchronous or return a promise. Errors they throw
 * reach the store's `onError` and never a render.
 */
export interface PersistAdapter {
  load(): string | null | Promise<string | null>;
  save(json: string): void | Promise<void>;
}

/** The part of Web Storage the adapter uses: `localStorage`, `sessionStorage` or anything alike. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The part of `@react-native-async-storage/async-storage` the adapter uses. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The part of a `react-native-mmkv` instance the adapter uses. */
export interface MmkvLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

/**
 * Persists under `key` in Web Storage. The storage object is looked up on each call, so the
 * adapter can be created where `localStorage` does not exist yet (server rendering) and fail,
 * through `onError`, only when it is used there.
 *
 * @param key - The storage key. Default `"oracular"`.
 * @param storage - The storage to use. Default `globalThis.localStorage`.
 */
export function localStorageAdapter(key = 'oracular', storage?: StorageLike): PersistAdapter {
  const target = (): StorageLike => {
    const found = storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
    if (found === undefined) {
      throw new Error('@oracular/react: localStorage is not available in this environment');
    }
    return found;
  };
  return {
    load: () => target().getItem(key),
    save: (json) => {
      target().setItem(key, json);
    },
  };
}

/** Persists under `key` in AsyncStorage (React Native). Pass the imported `AsyncStorage` in. */
export function asyncStorageAdapter(key: string, storage: AsyncStorageLike): PersistAdapter {
  return {
    load: () => storage.getItem(key),
    save: (json) => storage.setItem(key, json),
  };
}

/** Persists under `key` in an MMKV instance (React Native). Pass the instance in. */
export function mmkvAdapter(key: string, storage: MmkvLike): PersistAdapter {
  return {
    load: () => storage.getString(key) ?? null,
    save: (json) => {
      storage.set(key, json);
    },
  };
}
