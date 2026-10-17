# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |
| < 0.1   | no        |

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
