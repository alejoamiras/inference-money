# Phase 12 — Testnet build

Status: **done.**

- `deployments/testnet.json` is committed, from the Phase 7 deploy on v6 testnet.
- `web.yml` builds with `build:testnet` again; the fixture build and its `test ! -e deployments/testnet.json` guard are gone.
- `bun run --cwd apps/web build:testnet`: exit 0. The manifest identity test passes (1/1): the embedded manifest equals the committed file, and the bundle names its node, router, portal and bridge. `_headers` is non-empty, and its CSP `connect-src` allows exactly `'self' data: blob: https://lb.drpc.live`.
