# Phase 9 — Testnet, through keyed runs

Status: **in progress**: step 1 done (the admin address `0x094fe37a…6915`, committed into the deploy template); the deploy run is next.

## Findings

1. **`op-remote create` refuses an item that exists** (I8 was wrong: it never adds fields). With every template on one item, the admin request, which must run before the deploy request can be filed, would have created it with the admin field alone, and the deploy fields could then only be added by hand. The admin secret moved to its own item, `Keyed-Runs/InferenceMoney-Testnet-Admin`; deploy and fund keep `Keyed-Runs/InferenceMoney-Testnet`. Each role's first request runs `op-remote create <host> <id>` before `op-remote <host> <id>`.
2. **The first `admin address` run printed the address but exited 1**: its scan found no secret and one wallet store on disk. It was the previous local e2e's sidecar's: the harness had killed it after 20 s of shutdown, before it could remove its own pid's directory, and `admin address` opens no wallet, so nothing reaped it first. The harness now removes that directory itself, and the run is repeated so every keyed command exits 0.

## Keyed runs

| Request | Command | Result |
|---|---|---|
| `admin-address-256bfd87` | `bridge admin address` | never ran: its 1Password item did not exist (superseded) |
| `admin-address-7958540b` | `bridge admin address` | address printed; exit 1 from the scan (finding 2) |
| `admin-address-4d355f1f` | `bridge admin address` | the same address; scan clean; exit 0 |
