# Security Policy

SnapHood is an open-source demo launchpad. We appreciate responsible disclosure and will work with you to fix verified issues.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately using GitHub's **[Private vulnerability reporting](https://github.com/wrkrdev/snaphood/security/advisories/new)** (repository **Security → Report a vulnerability**). We aim to acknowledge reports within a few days and will coordinate a fix and disclosure timeline with you.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, ideally with a proof of concept.
- The affected route, component, or contract, and any relevant configuration.

## Scope

**In scope** — code in this repository: session/auth handling, API routes and their rate limits, the wallet launch and trading flows, request/origin guards, and the token contract in `contracts/`.

**Out of scope** — third-party services (Wrkr, Robinhood Chain, Dexscreener, Uniswap, AI/image providers), social engineering, denial of service, and anything that requires a already-compromised host, database, or wallet.

## Secrets

Real secrets are never committed — they live only in a local, git-ignored `.env.local`, and `.env.example` ships blank placeholders. `npm run verify:secrets` runs in CI to guard against accidental commits. If you believe a secret has been exposed, report it privately as above rather than in a public issue.

## Note

This is a demonstration project. It ships non-spending demo defaults; live token launches and on-chain trading require deliberate configuration (see [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md)).
