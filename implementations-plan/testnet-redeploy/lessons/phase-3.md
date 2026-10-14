# Phase 3: KEYED 2, admin accept; demo setup to the listing (2026-10-14)

| Attempt | Result | Consequence |
|---|---|---|
| Order (director) | KEYED 2 before the fund-only rerun: the accept reads no L1 RPC secret and does not depend on funding. | — |
| KEYED 2 `admin-accept-ddc14338`: `bun run bridge admin accept deployments/testnet.json` under the admin template, keyed tree at ec9de48 | Exit 0. The admin account `0x17ff77f710f7f3a1795919a89a6eae38a6e18ac9da211a3c68e09804efd99490` deployed through the sponsor (L2 tx `0x0dc871cf3a182f1376be0718e8f2a54263ada9d0c1e3382c70a0b0ab7b6b1da0`), then claimed ownership and accepted the merchant admin role (L2 tx `0x0432a35ef133532c11bb36e603055c4028d1d869d8c341352b4470cabf06dc4d`). Scan `found=false files=3997 skipped=0 walletDirs=0`. | The manifest gains `l2.admin` = Phase 1's address; copied byte-identical. |
| Keyless `bun run bridge verify deployments/testnet.json` (strict) after the accept | Exit 0, "every check passed", 56 `ok`: both creation txs, `bridge owner == admin`, `merchant admin == admin`, `no deploy key keeps a role`, `merchant delay setting == manifest: 86400`. | The handover is complete. `demo setup` waits for the fund-only run: its merchant bindings are one-cent deposits from galactica's and supplier's Ethereum accounts, both still empty. |
