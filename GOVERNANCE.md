# Governance

oracular is a small open-source project with one maintainer, Ibrahim Ragab ([@Yuribenjamin](https://github.com/Yuribenjamin)). This document says how decisions are made today and how that changes as the project grows.

## Roles

- **Users** use the library and shape it by opening [issues](https://github.com/Yuribenjamin/oracular/issues) and [discussions](https://github.com/Yuribenjamin/oracular/discussions).
- **Contributors** open pull requests. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Contributors keep the copyright to their work and license it under the project's [MIT license](LICENSE).
- **Maintainers** review and merge pull requests, triage issues, cut releases, own the [roadmap](https://yuribenjamin.github.io/oracular/guide/roadmap) and hold admin access to the GitHub repository and the npm package. Today there is one maintainer.

## How decisions are made

- Bug fixes, documentation and tests are decided in the pull request.
- Changes to the model, the public API or the serialized state format are discussed first, in a GitHub Discussion in the "Modelling" category, together with the integration that needs them. The roadmap page records what was decided and why.
- The maintainer has the final say. Disagreements are worked out in the open, in the discussion or the pull request, never in private.

## Becoming a maintainer

A contributor who has landed several non-trivial pull requests, reviews other people's work and follows the Code of Conduct can be invited by the maintainer to become one. A new maintainer starts with write access to the repository; admin access to the repository and to the npm package follows after cutting a release together with an existing maintainer.

## Continuity

There is one administrator on GitHub and on npm today, so the project cannot yet continue without interruption if the maintainer is unavailable. The intent is to add a second trusted administrator on both as soon as a regular contributor appears. Until then, everything needed to continue is public: the code, the documentation, the release workflow and this document. Publishing happens only from CI through npm trusted publishing, so no secret would have to change hands.

## Security and conduct

Vulnerabilities are reported privately, as [SECURITY.md](SECURITY.md) describes. Code of Conduct concerns go to the maintainer at the address in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Changing this document

Governance changes are made by pull request like any other change and noted in the changelog.
