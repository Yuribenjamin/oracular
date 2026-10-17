---
"oracular": patch
---

Fix the `exports` map: the `default` condition now points at the CommonJS build and stays last, so resolvers without an `import`/`require` condition (Jest's jsdom environment, some bundlers) get a file they can load. ESM-first resolvers still get the ESM build.
