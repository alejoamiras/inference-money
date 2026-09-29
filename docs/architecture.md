# Architecture

**Deposit (L1 → L2).** The user signs one Permit2 witness transfer naming `Permit2DepositRouter`, which pulls exactly `amount` USDC and deposits it into `TokenPortal`. The portal locks the USDC and sends an L1→L2 message whose content hash binds the amount and (public) recipient. On Aztec, `token_bridge.claim_public` / `claim_private` consumes the message and mints through `token_minter_proxy`, the Token's only minter. Private claims re-derive the message secret in-circuit from a salt and the recipient, so only the committed recipient can be credited.

**Withdraw (L2 → L1).** `token_bridge.exit_to_l1_*` burns the L2 balance and emits an L2→L1 message binding the L1 recipient and amount. Once the epoch is proven, anyone holding the membership witness calls `TokenPortal.withdraw`, which consumes the message in the Outbox and pays out.

**Cross-toolchain keystone.** The content hashes and the claim-secret derivation are pinned by identical literal vectors in Noir, Solidity and TypeScript; a drift in any one strands deposits.
