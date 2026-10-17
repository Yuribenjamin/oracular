## What

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem this solves, or the behaviour it changes and why that is right. -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] new behaviour has tests, and `assertInvariants` is called after every state-returning operation
- [ ] public JSDoc updated (`@param`, `@returns`, `@throws`, `@example`): it is the API reference
- [ ] README "How it works" and the concept page updated if the model changed
- [ ] a changeset if behaviour changed (`npm run changeset`); none needed for docs, CI, tests or refactors
- [ ] no new runtime dependency, no I/O, no `Date.now()` inside `src/`
- [ ] commit messages follow Conventional Commits
