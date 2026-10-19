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
});
