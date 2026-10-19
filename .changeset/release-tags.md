---
"oracular": patch
---

**Release tags.** From this release, each release is tagged `oracular@<version>` instead of `v<version>`, and the GitHub release that goes with it is created per package. The reason is the repository's shape: it is now an npm workspace, with the root still the `oracular` package, so that a second package can be published from it; Changesets names tags that way in a workspace, and this release is the one that proves the pipeline end to end before anything depends on it. Nothing in the library changes. What also does not change: the existing `v0.1.0` to `v0.8.0` tags stay where they are, and there is no `v` alias for new releases. If you pin by tag, `oracular@0.8.1` is the first of the new form, and from here on the tag is the package name followed by the version.
