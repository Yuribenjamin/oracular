import { describe, expect, it } from 'vitest';
import { asyncStorageAdapter, localStorageAdapter, mmkvAdapter } from '../src';

describe('persistence adapters', () => {
  it('localStorageAdapter: the given storage, or the global one, under the key', async () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const adapter = localStorageAdapter('k', storage);
    expect(await adapter.load()).toBeNull();
    await adapter.save('{"a":1}');
    expect(memory.get('k')).toBe('{"a":1}');
    expect(await adapter.load()).toBe('{"a":1}');

    const global = localStorageAdapter();
    await global.save('x');
    expect(localStorage.getItem('oracular')).toBe('x');
    expect(await global.load()).toBe('x');
    localStorage.removeItem('oracular');
  });

  it('localStorageAdapter without any storage fails on use, not on creation', () => {
    const adapter = localStorageAdapter('k', undefined);
    const saved = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      expect(() => adapter.load()).toThrow('localStorage is not available');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true });
    }
  });

  it('asyncStorageAdapter and mmkvAdapter wrap the storage you pass in', async () => {
    const memory = new Map<string, string>();
    const asyncStorage = {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const a = asyncStorageAdapter('k', asyncStorage);
    expect(await a.load()).toBeNull();
    await a.save('1');
    expect(await a.load()).toBe('1');

    const mmkv = {
      getString: (key: string) => memory.get(key),
      set: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const m = mmkvAdapter('m', mmkv);
    expect(m.load()).toBeNull();
    m.save('2');
    expect(m.load()).toBe('2');
  });

  it('remove deletes the key through removeItem, removeItem and delete', async () => {
    const memory = new Map<string, string>();
    const web = localStorageAdapter('k', {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    });
    await web.save('1');
    await web.remove?.();
    expect(memory.has('k')).toBe(false);

    const native = asyncStorageAdapter('a', {
      getItem: async (key) => memory.get(key) ?? null,
      setItem: async (key, value) => {
        memory.set(key, value);
      },
      removeItem: async (key) => {
        memory.delete(key);
      },
    });
    await native.save('2');
    await native.remove?.();
    expect(memory.has('a')).toBe(false);

    const mmkv = mmkvAdapter('m', {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
      delete: (key) => {
        memory.delete(key);
      },
    });
    mmkv.save('3');
    mmkv.remove?.();
    expect(memory.has('m')).toBe(false);

    const global = localStorageAdapter();
    await global.save('x');
    await global.remove?.();
    expect(localStorage.getItem('oracular')).toBeNull();
  });

  it('remove on a storage without the method fails with a clear message', () => {
    const bare = { getItem: () => null, setItem: () => {} };
    expect(() => localStorageAdapter('k', bare).remove?.()).toThrow('has no removeItem');
    expect(() =>
      mmkvAdapter('m', { getString: () => undefined, set: () => {} }).remove?.(),
    ).toThrow('has no delete');
    expect(() =>
      asyncStorageAdapter('a', { getItem: async () => null, setItem: async () => {} }).remove?.(),
    ).toThrow('has no removeItem');
  });
});
