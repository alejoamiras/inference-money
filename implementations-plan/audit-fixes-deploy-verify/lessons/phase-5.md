# Phase 5: Codex fix loop (gpt-6.1-sol, high)

## Round 1: Phases 1–2, `ad77d10..3040770`
Codex session `01a1361d-136f-76a0-8503-595cb49606d3`. Verdict: changes requested; delay policy sound.

1. **Accepted, medium**: `deployEvm` signed whatever chain id `prepareTransactionRequest` returned. Checked in viem 2.56.7's source: the `eth_fillTransaction` result is spread over the request (`chainId` included), and `getChainId()` then returns `request.chainId`. The explicit nonce survives, since viem re-applies it after the fill. Fix: refuse `request.chainId !== chain.id` before signing; a fake-RPC case answers the fill with chain 1 and asserts nothing was sent. Fee and gas fields stay as viem prepares them.
2. **Accepted, low**: `createdAsBuilt` combined `getTransaction` and `getTransactionReceipt` answers without checking that either belongs to the manifest's hash. Fix: both returned hashes must equal it; one case per mismatch.
3. **Accepted, comment**: deleted the `DelayReadBack` doc line and the `judged` test-helper comment; both restated their code.

## Round 2: round-1 fixes plus the merged withdraw-only mode (`97a4994`, merge `54e2758`)
Same session, resumed (one send was cancelled before an answer, then resent with refs pinned to the merge commit). Verdict: no new material finding in withdraw-only mode; one low hole in the round-1 fix.

1. **Accepted, low**: `createdAsBuilt` took `.find()`'s result as the mismatch, so an absent hash (`undefined`, falsy) passed and could also hide the receipt's mismatch. Fix: compare both hashes directly; regression rows for a missing tx hash and a missing receipt hash.
2. **Accepted, comment**: deleted the `portal` fixture's comment in `actions.test.ts`; it narrated the fixture.

Codex found sound: the merge's composition (options object, creation checks, delay policy; closed deposits only add a warning), the identity reads across blocks (only the canonical rollup can change), and the false-open / false-closed costs within the endpoint-trust boundary.
