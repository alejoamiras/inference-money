# Phase 9 — Testnet, through keyed runs

Status: **in progress**: step 1 done (the admin address `0x094fe37a…6915`); step 2 deployed and funded (bridge `0x0c179967…1924`, `deployments/testnet.json`), its scan a false positive (finding 4); step 3 done (admin accepted, galactica and supplier listed); demo setup and the recorded smoke are next.

## Findings

1. **`op-remote create` refuses an item that exists** (I8 was wrong: it never adds fields). With every template on one item, the admin request, which must run before the deploy request can be filed, would have created it with the admin field alone, and the deploy fields could then only be added by hand. The admin secret moved to its own item, `Keyed-Runs/InferenceMoney-Testnet-Admin`; deploy and fund keep `Keyed-Runs/InferenceMoney-Testnet`. Each role's first request runs `op-remote create <host> <id>` before `op-remote <host> <id>`.
2. **The first `admin address` run printed the address but exited 1**: its scan found no secret and one wallet store on disk. It was the previous local e2e's sidecar's: the harness had killed it after 20 s of shutdown, before it could remove its own pid's directory, and `admin address` opens no wallet, so nothing reaped it first. The harness now removes that directory itself, and the run is repeated so every keyed command exits 0.
3. **The L1 key to import is the one that deployed usdc-bridge to testnet**: nulo's Sepolia-only deployer `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`, which predates keyed runs and was kept in that plan's git-ignored `.env.testnet`. On 2026-10-01 it held 4.378 ETH and 31.70 USDC (public reads), 18.3 short of the 50 that `demo fund` transfers, so it is topped up before the deploy run is approved.
4. **The deploy run's scan matched the public RPC endpoint.** The deploy, the verification and `demo fund` all passed, then `secrets:scan` reported `found=true`. The scan takes every `*RPC_URL` value as a needle, and `SEPOLIA_RPC_URL` held the public default that `networks.ts` commits (the owner pasted it as told), so it matched the source. That endpoint is no longer a needle, and a scan-only run with the same three secrets then found nothing.
5. **The first `demo setup` died on bob's binding deposit, out of gas.** The tx (`0xcde25ccb…16eb`) used 230,628 of its 232,285 limit, viem's bare estimate; replayed at its parent block it needed 274,638 (+18%), because the Aztec Inbox insert costs more once the rollup has opened a new message tree, which it does every few blocks. Every deposit now sends its estimate plus half (`withInboxHeadroom`), estimated before the draft counts as sent. Nothing was lost: alice's deposit had landed and its ticket was stored, and a resumed setup re-deposits bob's only once the reverted draft's permit deadline is final.

## Keyed runs

| Request | Command | Result |
|---|---|---|
| `admin-address-256bfd87` | `bridge admin address` | never ran: its 1Password item did not exist (superseded) |
| `admin-address-7958540b` | `bridge admin address` | address printed; exit 1 from the scan (finding 2) |
| `admin-address-4d355f1f` | `bridge admin address` | the same address; scan clean; exit 0 |
| `deploy-dbc95cd0` | `probe:testnet`, `bridge deploy testnet`, `bridge demo fund` | deployed, verified, funded; exit 1 from the scan (finding 4) |
| `deploy-scan-87b7d4a0` | `secrets:scan` alone, on the deploy template | `found=false`; exit 0 |
| `admin-accept-016ec12e` | `bridge admin accept`, `bridge merchants add <galactica> <supplier>` | both roles accepted; 2 merchants in 1 tx; scan clean; exit 0 |

## Codex, arc 4 boundary (GPT-6 Astra, high; session `01a0f807…a9e9`, account alejo-gmail)

The arc-4 loop stopped at its cap with `cd59491` unreviewed (phase-8.md); this pass reviews it with P9's changes.

**Round 1:** not converged, six findings, all verified against the code and accepted:

1. **High: the deployment marker came too late.** A deploy that finished on-chain but died before `.deployment` was written, or two concurrent deploys, let a second deploy through, and `destroy` after handing over one would strand the other's roles. The marker is now created exclusively and flushed before the deploy starts and filled with the bridge on success; an empty one blocks a redeploy and `destroy`.
2. **High: `destroy` trusted the manifest's token.** A manifest pairing the real bridge with another token could show both roles handed over while the real token's merchant admin stayed with the keys. The token is now read from the bridge's own config and must match, and the roles are read at the pinned testnet node, not the manifest's.
3. **Medium: the verify recipe checked out the commit that predates the manifest**, replacing the file it then verified; it now copies the manifest out first. The docs also said deploy keys lose their roles at deployment; it is at the admin's acceptance.
4. **Medium: withdrawals and the deployer's USDC refills kept bare estimates.** Crediting a balance emptied since the estimate costs more (zero to nonzero), and the demo accounts' keys are public. One helper, `withGasHeadroom`, now covers deposits, withdrawals and every deployer EVM write.
5. **Low: the public-endpoint exemption compared strings.** `:443/` and the committed Aztec node URL still made needles; URLs are now normalized and both committed endpoints exempted.
6. **Low: comments.** The headroom comment cited the incident and stated its cause as fact; the marker comment narrated. Both rewritten.

**Round 2:** confirmed the six fixes; not converged, two findings, both accepted:

1. **High: a `destroy` in flight could delete a bundle drawn after it.** Two destroys could both pass their checks; one deletes, `init` draws a new bundle, and the other, resuming, deletes the new keys. `init`, `exec` and `destroy` now hold the bundle's lock (`withStateDir`, beside the file) for their whole run.
2. **High: the marker's directory entry was not flushed**, so a host crash could keep the keys and lose the marker. The marker, the recorded bridge (now written atomically), the keys and the deletion each sync their directory, with `run-state.ts`'s `writeDurably` and `syncDir`.

**Round 3 (the cap):** confirmed both round-2 fixes; not converged, one finding, accepted:

1. **High: the round-2 lock broke `exec`'s cancellation.** `withStateDir` registered its signal handler before `runRedacted`'s reaper, so a SIGINT or SIGTERM released the bundle and exited while the detached, secret-bearing child kept running, unscanned. `exec` now takes the lock with `StateDir.acquire` and releases it in `finally`, so `runRedacted` reaps the child and the scan runs first; `init` and `destroy`, which spawn nothing, keep `withStateDir`. A test emits SIGTERM mid-run and requires the child gone, the scan run and the bundle free.

Past the cap with one fix unreviewed, the loop continues for a confirming round, per the owner's standing call on loops at the cap: minimal fixes only.

**Round 4 (confirming):** converged — "Converged — no material findings remain in the reviewed arc-4 boundary; confidence high." Codex drove SIGTERM then SIGINT against a child that ignores SIGTERM: a second exec was refused, the child was killed, the scan ran before the release, and the next exec succeeded. A SIGKILL leaves the lock, which `StateDir` never takes over on its own.
