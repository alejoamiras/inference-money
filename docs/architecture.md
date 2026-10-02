# Architecture

**Deposit (L1 → L2).** The user signs one Permit2 witness transfer naming `Permit2DepositRouter`, which pulls exactly `amount` USDC and deposits it into `TokenPortal`. The portal locks the USDC and sends an L1→L2 message whose content hash binds the amount, the depositor and (public) the recipient. On Aztec, `token_bridge.claim_public` / `claim_private` consumes the message and mints through `token_minter_proxy`, the Token's only minter. Private claims re-derive the message secret in-circuit from a salt and the recipient, so only the committed recipient can be credited.

**Withdraw (L2 → L1).** `token_bridge.exit_to_l1_*` burns the L2 balance and emits an L2→L1 message binding the L1 recipient and amount. Once the epoch is proven, anyone holding the membership witness calls `TokenPortal.withdraw`, which consumes the message in the Outbox and pays out.

**Cross-toolchain keystone.** The content hashes and the claim-secret derivation are pinned by identical literal vectors in Noir, Solidity and TypeScript; a drift in any one strands deposits.

**Message formats.** Each content is `sha256ToField(abi.encodeWithSignature(signature, args…))`, built by `TokenPortal.sol`, `contracts/aztec/portal_messages` and `packages/bridge-core/src/content-hash.ts`:

| Message | Signature | Arguments |
|---|---|---|
| Public deposit | `mint_to_public(bytes32,uint256,address)` | recipient, amount, depositor |
| Private deposit | `mint_to_private(uint256,address)` | amount, depositor; the recipient is bound through the claim secret |
| Withdraw | `withdraw(address,uint256,address)` | L1 recipient, amount, L1 caller (zero: anyone may submit) |

The depositor is the address the USDC came from on Ethereum. A direct deposit names its caller. `Permit2DepositRouter` calls the portal's router-only `depositToAztec{Public,Private}For`, which name the Permit2 signer the router pulled from. The portal accepts those calls from one router only: the one `initialize` bound after checking that it names this portal and its token. A claim must present the same depositor; any other address hashes to a message that does not exist.

## Merchant token

`contracts/aztec/token` is aztec-standards' Token with a merchant list and its rules. Every upstream function keeps its ABI and upstream's storage comes first, so integrations written against upstream keep working.

**The rules.**
- A private transfer, through any entry point, needs a merchant on one side. Public-to-public transfers, mints and burns are upstream's.
- Opening a payment request (a partial note's commitment `c`) needs a merchant on one side too, and records which: the token pushes `stamp(c)` when the recipient is a merchant, `pad(c)` otherwise. Both are one token-siloed nullifier, so an observer can't tell them apart.
- A user may pay only into a stamped request; a merchant may pay into any.

**The list.** The merchant admin adds merchants at once into an append-only register. It switches one off through a `DelayedPublicMutable` entry, which takes the entry's delay (1 to 24 h) to land. Within that delay the admin, or a guardian if one is set, can cancel. The guardian slot is replaced on the same delay.

**How a check proves.** The token reads the register and the entry privately, at the tx's anchor block; a public call would publish both accounts. An unconstrained hint picks which side to prove: the tx's capsule, which bridge-core computes from the list it syncs whole (`merchants.ts`), else a probe of the anchor block. A wrong hint only makes the tx unprovable.

**Expiry.** Reading an entry caps the tx's expiry at `anchor + D − 1`, or at the pending change − 1. The PXE then rounds every expiry down from the anchor, to whole hours, else half hours, else seconds. With D = 24 h and nothing pending, a merchant check lands on the 23 h every tx gets, so it neither shortens the tx nor stands out. A 1 h entry, or one with a change pending, cuts the tx to 30 minutes or less.

**Paying a request** (`payments.ts`). The opening tx hands its sender the commitment as an offchain effect. Completion isn't single-use, and the recipient discovers only the first, so a second payment into one request is lost. `payRequest` refuses a request that is completed on chain, or that this client has paid or is paying. It keeps one record per request: reserved, then sent, then paid. The payer's wallet must be built on a `PaymentGate`'s node, which writes `sent` between proving and the node receiving the tx. Only finalized chain state moves a `sent` record on, since a prune can undo anything short of it.
