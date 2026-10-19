# oracular + React, with Vite

A pricing page wired to the `upgrade` preset through `@oracular/react`, with the inspector in a side panel. Everything stays in this browser's `localStorage`.

```sh
npm install                          # at the repository root: the app links both packages from the workspace
npm run build && npm run build -w packages/react
npm run dev -w examples/react-vite
```

Click around: each button is an event. The offer appears once `shouldReveal` is true, the outcome button resets the evidence, and "Sign out" ends the session; a 30-minute idle gap ends it on its own. The panel is `renderInspector(inspect(state, now))`, re-rendered on every change.

With `?demo` in the URL the app runs on a virtual clock instead of `Date.now`, persists nothing, and exposes the clock as `window.oracularDemo` (see `src/demo.ts`). `npm run docs:gif` at the repository root drives it through the system Chrome to record `assets/inspector.gif`, the image at the top of the README; the production build is the same with or without the parameter.
