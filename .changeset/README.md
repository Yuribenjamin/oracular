# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Each
Markdown file here describes one pending change to `oracular` and the version bump it needs.
`changeset version` turns them into a version bump and CHANGELOG entries; `changeset publish`
publishes the result.

## Adding one

```sh
npm run changeset
```

Pick the bump, then write the entry for people who use the library, not for people who read the
diff. One sentence is usually enough. Commit the generated file with your change.

## Which bump

While the version is **0.x**:

- **minor**: any change in behaviour that could break an existing integration, and any new
  feature. In 0.x, a breaking change is a minor bump, not a major one.
- **patch**: bug fixes and changes that nobody has to react to.
- **major**: not used before 1.0.

Pull requests that change no behaviour (docs, CI, tests, refactors with identical output) need no
changeset.

Read the full guide at https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md
