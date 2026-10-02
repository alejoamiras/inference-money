# Phase 14 — `/harden security medium` on `contracts/`

Status: **done** 2026-10-01. Run `2026-10-01-contracts`, on `6f3b0b3`. The outputs stay local in `audit/security/2026-10-01-contracts/` (git-ignored: a vulnerability inventory); this file and the plan are the record.

Stakeholder report: https://claude.ai/artifact/61eDLDu7BmAkdSTfKxw6sD

## Run

- Scope: the production sources of `contracts/evm/src` and the six Aztec crates (2,159 LOC); tests, mocks, `keystone`, artifacts and the build scripts excluded.
- Six clusters: `evm-portal`, `evm-router`, `l1l2-message-seam`, `noir-token-merchants`, `noir-token-transfers`, `noir-bridge`. Each was audited blind by Claude Sonnet 5 and by Codex (GPT-6 Astra, medium, account alejo-gmail).
- Phase 3: a Sonnet coordinator. Phase 4: a fresh Sonnet verifier that answered from the source before reading the claim, and the raising Codex session resumed with a refutation brief.
- Raw result: Codex 1 finding (portal), Claude 1 (token transfers), the other ten legs none.

## Triage

| Finding | Band | Verdict | Reason |
|---|---|---|---|
| C-001: a public deposit to a recipient at or above the field modulus is locked for good (`TokenPortal._depositPublic`) | Low | **Accepted**, fixed in P15 | Confirmed by both verifiers and re-read by the driver. The harm is the depositor's own funds through their own malformed input, but the loss is permanent, and about 81% of arbitrary 32-byte values trigger it. The owner chose fix + redeploy (2026-10-01) over fixing without a redeploy or documenting only. |
| `transfer_public_to_public` has no merchant rule | — | Rejected at reduce | Documented and tested design (`docs/architecture.md:40`, plan lines 151 and 751, TXE `public_to_public_is_unrestricted`). Public transfers are visible, and all six private entry points prove a merchant side first. |

C-001's fix as verified: revert when `uint256(_to) > Constants.MAX_FIELD_VALUE`, right after the amount check (the u128 proofs take a symbolic recipient and expect exactly the cap error), behind a virtual guard. Not mirrored in the router: both verifiers agree the portal's check suffices, since routed deposits reach the same function and the revert unwinds the Permit2 pull. Claude also suggested a router copy, following the duplicated amount cap; declined, as it adds an error, a proof and a canary and protects nothing more.

## Findings

1. **The context brief omitted one documented decision**, so a Claude leg flagged `transfer_public_to_public`. Handing the coordinator the decision with its sources and a falsifiable bar (a path into or out of private state without a merchant side) settled it. Build an audit's documented-design list from the docs' rule statements and the plan's per-function table, not from memory.
2. **Only one model found C-001.** Claude's portal leg checked the amount cap and the hash parity in depth and missed the recipient's range. Codex found it. This is the case the two-family protocol exists for.
3. **The Inbox's range checks look complete and are not.** They cover the message's actor, content hash and secret hash, never a value folded into the hash. Any message field that must be an Aztec value needs its own L1 check.
