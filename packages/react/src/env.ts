// Vite, webpack and Metro replace `process.env.NODE_ENV` at build time, and Node and Hermes have
// it at run time, so the read is right wherever the package is bundled. In plain browser ESM
// without a bundler the read throws, and the warnings stay on: nothing minified the code either.
// (A `typeof process` check first would defeat the build-time replacement.)
declare const process: { env: Record<string, string | undefined> };

/** True in a development build, where the store warns about what it would otherwise swallow. */
export const DEV: boolean = (() => {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
})();
