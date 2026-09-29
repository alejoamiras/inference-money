# contracts/aztec

Aztec.nr side of the USDC bridge, pinned to aztec-nr **v6.0.0-rc.1** (the `noir` entry in `toolchain.json`).

| Crate | Type | Role |
|---|---|---|
| `token_bridge` | contract | Consumes L1→L2 deposit messages (`claim_public`, `claim_private`), burns + messages L1 on exit; owner pause. |
| `token_minter_proxy` | contract | Sole minter of the standards `Token`; only the bridge may mint or burn, fixed once at bootstrap. |
| `claim_secret` | lib | `derive_claim_secret(salt, recipient)`: binds a private deposit to its recipient. |
| `keystone` | bin | Literal vectors pinning the Noir content hashes and claim-secret derivation to the Solidity and TS ones. |

The two contract artifacts in `*/target/` are committed: the SDK and deployer import them and CI does not rebuild them
to deploy.

## Commands

nargo comes from `aztec-up install 6.0.0-rc.1`, or `NARGO=<path>` to the noir-lang release (the scripts check it is `toolchain.json`'s `nargo`). The aztec CLI, bb and
the TXE server come from `toolchain/`, a committed lockfile installed with `--frozen-lockfile` on first use.

```sh
bash scripts/noir-deps.sh            # fetch + verify every Noir git dependency against its pinned commit
bash scripts/compile.sh              # rebuild the contract artifacts (nargo + AVM transpile + path scrub)
bash scripts/compile.sh --check      # fail unless the committed artifacts are exactly what the source builds
bun run test:noir                    # TXE suites for token_bridge and keystone, each gated by its txe-manifest.txt
bash scripts/check-sole-consumer.sh  # static recipient-commitment guard (add --self-test to prove it bites)
```

Never run a bare `nargo compile`: it overwrites a committed artifact with an untranspiled one that aztec.js rejects.
`scripts/nargo.sh <crate> <args>` runs the pinned nargo for anything else.
