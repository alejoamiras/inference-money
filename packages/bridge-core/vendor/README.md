# Vendored artifacts

Both come from the npm packages the 5.0.0 `aztec-up` toolchain installs, and both are pinned by the address they derive (`src/artifacts.test.ts`, `src/compat.test.ts`), which commits to the full class.

| File | Source (npm integrity) | sha256 | Derives |
|---|---|---|---|
| `sponsored_fpc_contract-SponsoredFPC-5.0.0.json` | `@aztec/noir-contracts.js@5.0.0` `artifacts/sponsored_fpc_contract-SponsoredFPC.json` (`sha512-HMw1NlIAFTV6d8M27qRzS6vLmFD/k8mgCWwpbKfgeoPkQ3mIJIBkMCg7QgJFl3ULFNn1swqB75FWtfQjRAWS2A==`) | `648b856a…8e08` | salt 0 → `0x0628377e…3fe1`: the SponsoredFPC published on testnet and funded at genesis on a 5.0.0 local network |
| `HandshakeRegistry-5.0.0.json` | `@aztec/standard-contracts@5.0.0` `artifacts/HandshakeRegistry.json` (`sha512-4U6AjjiEEuxnCswfthEdetZJdfu1FDeCnBajhLaMC/zkscNmUuiz153fXI9hM3aDtIKpUNUo90jk+cq+FO4qaA==`) | `eb646783…a1a0` | salt 1 → `0x0193c31b…1aa5`: the registry address aztec-nr 5.0.0 bakes into the SponsoredFPC |

The 5.0.0 node's sponsor is this exact class; `@aztec/noir-contracts.js@5.2.0` derives a different address. A 5.2.0 PXE also needs the 5.0.0 HandshakeRegistry to execute it: aztec.js 5.2.0 preloads only its own registry and the archived 5.0.1 one.
