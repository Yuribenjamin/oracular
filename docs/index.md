---
layout: home
title: oracular
titleTemplate: On-device intent engine

hero:
  name: oracular
  text: Your app learns when the user is ready. Nothing leaves the device.
  tagline: A tiny, zero-dependency, pure-functional intent engine. Feed it the events your app already has; it tells you when a user is likely to upgrade, churn, get stuck or buy, with enough confidence to act, and shows its reasons.
  image:
    src: /logo.svg
    alt: A tray of cookies
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Try the playground
      link: /playground
    - theme: alt
      text: API reference
      link: /api/

features:
  - icon: 🔒
    title: Private by construction
    details: There is no I/O in the library. No network, storage, DOM, timers or globals. Nothing can leave the device because nothing in the code could send it.
  - icon: 🧠
    title: Learns on-device
    details: Your weights are priors. Each user's own outcomes correct them, judging every signal against the sessions where it did not appear, right where the data lives.
  - icon: 🔍
    title: Explainable
    details: Every prediction comes with per-signal contributions and impact on p, so you can see exactly why something fired and tune it with numbers, not guesses.
---

## Quickstart

Install with `npm install oracular`, then:

<<< ../examples/quickstart.ts

With these numbers the offer fires after roughly six strong signals inside a week (p must clear 0.5 with a 90% lower bound); lower `priorStrength` or raise the weights to fire sooner. The block above is the same file the test suite runs, so it cannot rot.

Next: read the [guide](/guide/introduction), browse the [API reference](/api/), or [play with the engine](/playground) in your browser.
