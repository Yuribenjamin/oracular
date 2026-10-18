# Security policy

## Supported versions

| Version                  | Supported |
| ------------------------ | --------- |
| the latest minor release | yes       |
| anything older           | no        |

Fixes ship as a patch release of the latest minor line. Upgrading within a minor line never changes behaviour; the changelog says so when a minor does.

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/Yuribenjamin/oracular/security/advisories/new)
rather than in a public issue.

oracular is a one-person project for now. I aim to acknowledge a report within 72 hours and
to share an assessment, and a fix or mitigation where one is needed, within 14 days. I will
credit you in the advisory and the changelog unless you prefer otherwise.

## Scope

The library performs no I/O: no network, storage, DOM, timers or globals. Reports in scope are
therefore about the code paths that handle untrusted input, in particular:

- `deserialize` on a crafted JSON string (prototype pollution, denial of service, invariant
  violations),
- config, event and option validation that can be bypassed,
- anything that lets one party's data influence another's state.

Questions that are not security issues belong in
[Discussions](https://github.com/Yuribenjamin/oracular/discussions).

## Releases and supply chain

Every release is published by the [release workflow](.github/workflows/release.yml) from `main`, through npm trusted publishing: the registry authenticates the workflow run with a short-lived OIDC token, no maintainer holds an npm publish token, and nothing is ever published from a developer machine. Each published version carries a provenance attestation linking it to the commit and workflow run that built it; after installing, `npm audit signatures` verifies it.

The library has no runtime dependencies. Development dependencies are installed with `npm ci` against the lockfile's integrity hashes and monitored by Dependabot. GitHub Actions in the workflows are pinned to commit SHAs, which Dependabot keeps current, and CodeQL and the OpenSSF Scorecard run on every push to `main` and weekly.
