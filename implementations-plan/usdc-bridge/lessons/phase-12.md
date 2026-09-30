# Phase 12 — Testnet build

Status: **done.**

- `deployments/testnet.json` is committed, from the Phase 7 deploy on v6 testnet.
- `web.yml` builds with `build:testnet` again; the fixture build and its `test ! -e deployments/testnet.json` guard are gone.
- `bun run --cwd apps/web build:testnet`: exit 0. The manifest identity test passes (1/1): the embedded manifest equals the committed file, and the bundle names its node, router, portal and bridge. `_headers` is non-empty, and its CSP `connect-src` allows exactly `'self' data: blob: https://lb.drpc.live`.

## Arc 4 boundary codex pass

The codex session `01a0ef33-1f6a-7f53-9d6c-5148519b365f` was resumed on the Phase 7 + 12 delta (`87589ea..571ec7f`, plus `b84431a`). Verdict: **No new material findings.** It re-derived the manifest's addresses and classes and matched the pins and the sponsor. One Low was raised and accepted: `docs/ci-pipeline.md` still described the fixture build.
