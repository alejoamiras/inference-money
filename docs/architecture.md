# Architecture

**Deposit (L1 → L2).** The user signs one Permit2 witness transfer naming `Permit2DepositRouter`, which pulls exactly `amount` USDC and deposits it into `TokenPortal`. The portal locks the USDC and sends an L1→L2 message whose content hash binds the amount, the depositor and (public) the recipient. On Aztec, `token_bridge` consumes the message and mints through `token_minter_proxy`, the Token's only minter. `claim_public` mints to the recipient the message names, which must be a merchant, whoever submits it. `claim_private` re-derives the message secret in-circuit from a salt and the recipient, and only that recipient may submit it.

**Funding address.** A user account's first private claim binds it for good to that deposit's depositor: a `PrivateImmutable` note only the owner can initialize, delivered on chain so a restored wallet finds it again. Every later private claim must come from the same address, and the account withdraws only there. Merchants bind too, but exit to any address except the portal's; their public deposits never bind.

**Returns.** A deposit nobody may claim (a user's public deposit, or a private one from another address than the account's funding address) goes back to its depositor. `return_deposit_{private,public}` consumes the message, mints nothing, and emits the withdraw an exit to the depositor would; whoever holds the claim data may send it. A merchant's public deposit is claimed, never returned, since its secret is readable in the mempool once a claim is sent and anyone could otherwise bounce it.

**Withdraw (L2 → L1).** `token_bridge.exit_to_l1_*` burns the L2 balance and emits an L2→L1 message binding the L1 recipient and amount. A merchant exits publicly or privately to any address; a user exits only privately, and only to its funding address. Once the epoch is proven, anyone holding the membership witness calls `TokenPortal.withdraw`, which consumes the message in the Outbox and pays out. The owner's pause holds claims, returns and exits on L2, never a withdrawal already made.

**The books.** The portal's USDC always covers the L2 supply, every deposit not yet consumed and every withdrawal (exit or return) not yet paid out on L1, and integration asserts that equation at the end of each acceptance, returns and exit-rules spec.

**Cross-toolchain keystone.** The content hashes and the claim-secret derivation are pinned by identical literal vectors in Noir, Solidity and TypeScript; a drift in any one strands deposits.

**Message formats.** Each content is `sha256ToField(abi.encodeWithSignature(signature, args…))`, built by `TokenPortal.sol`, `contracts/aztec/portal_messages` and `packages/bridge-core/src/content-hash.ts`:

| Message | Signature | Arguments |
|---|---|---|
| Public deposit | `mint_to_public(bytes32,uint256,address)` | recipient, amount, depositor |
| Private deposit | `mint_to_private(uint256,address)` | amount, depositor; the recipient is bound through the claim secret |
| Withdraw | `withdraw(address,uint256,address)` | L1 recipient, amount, L1 caller (zero: anyone may submit) |

The depositor is the address the USDC came from on Ethereum. A direct deposit names its caller. `Permit2DepositRouter` calls the portal's router-only `depositToAztec{Public,Private}For`, which name the Permit2 signer the router pulled from. The portal accepts those calls from one router only: the one `initialize` bound after checking that it names this portal and its token. A claim must present the same depositor; any other address hashes to a message that does not exist.

## Showcase

`apps/showcase` is a static page that shows the bridge with the demo cast, never a visitor's own wallet. A build embeds one manifest, that deployment's recorded acceptance run (the tour) and the users' tag; nothing overrides them at runtime.

**Recorded run** (`#recorded`, the header's "Watch a recorded run"). Replays the recording scene by scene: each step's verdict, and what an observer of each chain sees, linked to the real txs on testnet. It needs no Aztec SDK and sends nothing.

**Try it yourself** (the default; `#live` too). The page's own embedded wallet (one PXE in the browser, its store in OPFS per deployment) holds the cast's accounts, whose keys are public, and signs A_demo's and B_demo's Ethereum txs the same way. A step is checked before anything is proven: a refusal quotes the contract's rule and sends nothing. A step the float can't afford replays the recording and says so. Unfinished cross-chain steps (a deposit to claim, a withdrawal to pay out) and payment records persist in `localStorage` per deployment, so a reload resumes them; the page pays a withdrawal out once its epoch's proof is on Ethereum. The page trusts its Ethereum RPC and Aztec node as readers: a record goes only when they say its step is final, or can no longer land. On a nullifier conflict, a one-send step whose refused tx already landed settles; anything else runs once more.

**Presto.** On a real-proof build the wallet proves through Presto's SDK (`src/presto/`), kept in the page until the visitor connects the Presto app from its ribbon in "Try it yourself", or their browser already lets the site reach apps on the device: nothing reaches the device before that. A revocation the browser reports, or one found just before a proof, puts every later proof back in the page, as does leaving "Try it yourself", so the recorded run and the proving harness always prove in the page; neither cancels a proof already under way. A proof that falls back checks Presto again, so the ribbon shows it if Presto went away. The Prove chip names Presto only for a proof that finished there.

**Headers.** COOP and COEP make the page cross-origin isolated, which bb.js's threaded wasm needs. The CSP lets it connect only to itself, the Aztec node, the L1 RPC and, when it proves, bb.js's CRS hosts and Presto's two loopback ports (HTTPS to prove, HTTP for the SDK's witness-free health diagnostic), and frames nothing. The CSP bounds where the page may connect; the visitor's consent, and the browser's own permission, decide whether it reaches Presto.

## Merchant token

`contracts/aztec/token` is aztec-standards' Token with a merchant list and its rules. Every upstream function keeps its ABI and upstream's storage comes first, so integrations written against upstream keep working.

**The rules.**
- A private transfer, through any entry point, needs a merchant on one side. Public-to-public transfers, mints and burns are upstream's.
- Opening a payment request (a partial note's commitment `c`) needs a merchant on one side too, and records which: the token pushes `stamp(c)` when the recipient is a merchant, `pad(c)` otherwise. Both are one token-siloed nullifier, so an observer can't tell them apart.
- A user may pay only into a stamped request; a merchant may pay into any.

**The list.** The merchant admin adds merchants at once into an append-only register. It switches one off through a `DelayedPublicMutable` entry, which takes the entry's delay (1 to 24 h) to land. Within that delay the admin, or a guardian if one is set, can cancel. The guardian slot is replaced on the same delay. A switch-off ends the account's merchant side from then on and revokes no stamp: a request stamped before it landed stays payable.

**How a check proves.** The token reads the register and the entry privately, at the tx's anchor block; a public call would publish both accounts. An unconstrained hint picks which side to prove: the tx's capsule, which bridge-core computes from the list it syncs whole (`merchants.ts`), else a probe of the anchor block. A wrong hint only makes the tx unprovable.

**Expiry.** Reading an entry caps the tx's expiry at `anchor + D − 1`, or at the pending change − 1. The PXE then rounds every expiry down from the anchor, to whole hours, else half hours, else seconds. With D = 24 h and nothing pending, a merchant check lands on the 23 h every tx gets, so it neither shortens the tx nor stands out. A 1 h entry, or one with a change pending, cuts the tx to 30 minutes or less.

**Paying a request** (`payments.ts`). The opening tx hands its sender the commitment as an offchain effect. Completion isn't single-use, and a stock wallet discovers only the first, so a second payment into one request is a valid note its recipient never sees. `payRequest` refuses a request that is completed on chain, or that this client has paid or is paying. It keeps one record per request: reserved, then sent, then paid. The payer's wallet must be built on a `PaymentGate`'s node, which writes `sent` between proving and the node receiving the tx. Only finalized chain state moves a `sent` record on, since a prune can undo anything short of it.
