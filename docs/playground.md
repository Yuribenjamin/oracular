---
title: Playground
aside: false
outline: false
---

# Playground

The engine on this page is the current `src/` of the repository, bundled into the site. **Everything runs in your browser.** Open your browser's network tab and click around: the only requests you will see are the site's own assets, and none of them is made by the engine. Nothing you do here is sent anywhere, because the library contains no code that could send it.

Use the virtual clock to move time forward, fire signals and the outcome, end episodes, mark reveals, and watch `predict`, `shouldReveal` and `explain` update after every click. Switch the lower bound between the normal approximation and the exact Beta quantile (`bound: 'exact'`, passed per call, so the config stays as written) and see where the two part on thin evidence. Edit the config as JSON and apply it to see validation errors inline, and open **What the engine knows** to see the entire state as the plain JSON that `serialize` produces.

<ClientOnly>
  <Playground />
</ClientOnly>
