---
"@oracular/react": minor
---

Capture caller-supplied events before delayed load replay, preventing object reuse from changing an outcome or its timestamp.

Acquire exclusive persistence ownership before storage I/O and release it after disposal completes. Competing stores report an error instead of overwriting history. AsyncStorage and MMKV coordinate by storage instance and key within one runtime; custom adapters can implement `acquire()` for platform locking across instances or runtimes. Browser localStorage requires Web Locks and fails safely when unavailable. Component-owned stores flush and dispose on unmount while preserving StrictMode reconnection.
