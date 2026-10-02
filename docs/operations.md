# Operations

Every operation is one `bun run bridge <command>`. `<manifest>` is a path, or `local` for this `RUN_ID`'s local run. Commands that need keys read them from their process environment only (see Keyed runs); everything else is keyless. The script starts the CLI with `bun --no-env-file`, and the CLI refuses to start without it: Bun would otherwise load a `.env` from the working directory into it.

## Commands

| Command | Keys (testnet) | Effect |
|---|---|---|
| `deploy local\|testnet [--merchant-delay <s>]` | L1 key, deployer secret, `SEPOLIA_RPC_URL`; plain `TESTNET_ADMIN_ADDRESS` | Deploys L1 then L2, wires them, proposes both admin roles to the admin, verifies, writes the manifest. Local accepts as the fixed local admin in the same run |
| `admin address` | admin secret | Prints the admin account's address, for the deploy template |
| `admin accept <manifest>` | admin secret | Deploys the admin account through the sponsor if needed, accepts the bridge's ownership and the merchant admin role, records `l2.admin` |
| `admin propose <manifest> <address>` | admin secret | Proposes both roles to a new admin, which takes them with its own `admin accept` |
| `merchants add <manifest> <account…>` | admin secret | Lists merchants, at once, four per tx |
| `merchants off\|on <manifest> <account>` | admin secret | Schedules a switch-off, or back on; it lands after the entry's delay |
| `merchants delay <manifest> <s>` | admin secret | Sets the delay (3600–86400 s) and syncs the merchants the node lists to it |
| `merchants guardian <manifest> <address>` | admin secret | Schedules the guardian (cancel-only); zero removes it |
| `merchants cancel <manifest> <account>` | admin or guardian secret | Cancels an entry's pending change |
| `merchants list <manifest>` | none | Every merchant ever added, with its status |
| `pause <manifest> on\|off` | admin secret | The bridge's L2 pause (see Emergency) |
| `verify <manifest> [--tour <file>] [--node <url>] [--l1-rpc <url>] [--guardian <address>]` | none | Strict read-back of the whole deployment; exits 1 on any failed check |
| `export <manifest> --out <dir>` | none | The integration bundle: manifest, Aztec artifacts, L1 ABIs |
| `smoke <manifest> [--record <file>]` | none | The acceptance run with the demo cast (see Demo) |
| `demo setup [--rotate] \| status \| reset <manifest>` | none | The demo cast (see Demo) |
| `demo fund <manifest>` | L1 key, `SEPOLIA_RPC_URL` | Tops A_demo and B_demo up on Ethereum, then the sponsor's Fee Juice |
| `disposable init \| exec <command…> \| destroy <manifest>` | the disposable file | The fallback when the owner is away (see below) |
| `manifest-path local` | none | This `RUN_ID`'s manifest path |
| `probe` | none | Testnet pins, L1 wiring, assets and the fee budget, before a deploy |
| `scan` | the run's own | Whether any of the run's secrets reached the checkout or the caches, and any wallet store left on disk: yes or no, never where |

Local commands skip proving unless `BRIDGE_PROVE=1`; testnet always proves.

## Keyed runs

A keyed command runs in a process whose environment the owner fills, one approval at a time, from 1Password on their own machine (`env-exec request`, approved with `op-remote`). Values are never printed, logged, passed on argv or written to disk: the CLI re-runs itself as a child whose output is redacted line by line whenever its environment holds a secret, and that child moves them out of its environment before the command runs, so no process it spawns (a prover, a build, git) inherits one.

1. Commit, push, then `bash scripts/keyed-worktree.sh sync`. It moves a detached worktree at `~/.cache/inference-money/keyed` to HEAD, pushes it as `keyed/testnet` (env-exec runs only a commit that is a branch tip), and installs with `--ignore-scripts`, so no install script ever sees a secret.
2. From that worktree, file the request with one of the templates. Every chain ends in the scan: `bash -c 'trap "s=\$?; bun run secrets:scan || s=1; exit \$s" EXIT; <commands>'`. The first request of each role needs its 1Password item: `op-remote create <host> <id>` makes it from the template (generating the `# op: generate` fields, asking for the imported ones), then `op-remote <host> <id>` approves the run. It refuses an item that exists, so each role has its own: `Keyed-Runs/InferenceMoney-Testnet` (deploy and fund) and `Keyed-Runs/InferenceMoney-Testnet-Admin`.
3. While the run is live, install, build, test and commit nothing anywhere on the host: each runs third-party code as the same user, which can read the run's environment.
4. Copy the run's outputs (manifests) into the working checkout, commit, and `keyed-worktree.sh remove` when done.

| Template | Variables |
|---|---|
| `deployments/testnet-deploy.env.example` | L1 key (imported), deployer secret (generated), `SEPOLIA_RPC_URL`; plain `TESTNET_ADMIN_ADDRESS` |
| `deployments/testnet-admin.env.example` | admin secret (generated) |
| `deployments/testnet-fund.env.example` | L1 key, `SEPOLIA_RPC_URL` |

`SEPOLIA_RPC_URL` is your own endpoint, or the committed public default (`networks.ts`), which the scan and the redaction treat as public.

The deploy run never sees the admin secret, and the admin run never sees the L1 key. The deploy keys lose every role once the admin accepts; `verify` fails if one keeps any. What a deploy key wrote before that stays: `verify` fails on a guardian it was not told to expect, and prints one line per listed merchant, to compare with the accounts you added. The register is append-only, so a deployment with a merchant you did not add is redeployed, not repaired.

**Testnet, in order:** `admin address` (commit the printed address into the deploy template); `probe` + `deploy testnet` + `demo fund` (one run, one L1 key, which must already hold Sepolia ETH for gas and 50 Circle Sepolia USDC, since `demo fund` transfers what A_demo and B_demo lack and nothing checks first); `admin accept` + `merchants add <galactica> <supplier>` (their addresses: `demo status`); then, keyless, `demo setup` and `smoke --record deployments/testnet-tour.json`.

**The disposable fallback**, for testnet only, when the owner is away: `disposable init` draws an L1 key, a deployer secret and an interim admin secret into `~/.cache/inference-money/disposable/testnet.env` (0600, outside every checkout, never overwritten) and prints only their addresses; the owner funds the L1 one at the faucets. `disposable exec <command…>` runs one bridge command from the keyed worktree, redacted, then scans; the child's environment holds only the values that command needs (`deploy`: the L1 key, the deployer secret and the admin address; `demo fund`: the L1 key; the admin, merchant-changing and `pause` commands: the admin secret; anything else: none). It refuses a file that is not 0600 and this user's. A bundle makes one deployment: its `deploy testnet` writes a marker beside the keys before starting and the bridge into it on success, and a second deploy is refused. A deploy that fails or dies first leaves the marker empty, and both a redeploy and `destroy` refuse until you establish what it created. An `admin accept` under it records `l2.interimAdmin`, and `verify` warns while that holds. The switch, once the owner is back: the keyed `admin address`; `disposable exec admin propose deployments/testnet.json <owner admin>`; the keyed `admin accept`; `verify`; `disposable destroy deployments/testnet.json`, which deletes the file only for the deployment the bundle recorded, and only once its last finalized block shows the manifest's admin, an account those keys don't control, holding both roles with nothing pending. The file is readable by any same-user process until then; that is accepted for test funds only.

## Verifying a deployment

`verify` is keyless and trusts what it reads through: the manifest's node and the pinned public L1 RPC by default. A pass proves the deployment matches its manifest and this commit's code, not whose deployment it is: USDC, Permit2 and the admin are compared with the manifest's own fields, so take the manifest from this repository or compare those three with addresses you already trust. Check a deployment from the commit that made it, against your own endpoints. A URL passed as a flag shows in the process list and in `bun run`'s echo of the command, so don't pass one that carries an API key. That commit predates the manifest it made, so copy the manifest out first:

```sh
cp deployments/testnet.json ~/testnet-manifest.json
git checkout <manifest.sourceCommit> && bun install --frozen-lockfile --ignore-scripts
bun run bridge verify ~/testnet-manifest.json --node <your node> --l1-rpc <your L1 RPC>
```

It checks the L1 bytecode against a fresh build, every binding between portal, router, bridge, proxy and token, the handover (complete, nothing pending, no deploy key holding a role), the guardian (none, in office or scheduled, unless `--guardian` names one), every merchant's delay and the guardian slot's against the setting, that the L2 supply is no higher than the portal's USDC (necessary, not sufficient: unclaimed deposits and unpaid withdrawals are liabilities too), and that demo merchants are listed only on local and testnet. `--tour` also checks a recorded tour's schema and that it belongs to this deployment.

**Old deployments.** A manifest names its `protocolVersion` and `sourceCommit`, and every stored ticket names its protocol version. Finish an old deployment's claims and withdrawals with the CLI of its `sourceCommit`: a newer one refuses its artifacts and names that commit.

## Merchants

- **Add**: `merchants add <manifest> <account…>`. At once; the admin may route adds through its own review (a multisig) instead.
- **Switch off**: `merchants off <manifest> <account>`. The account stays a merchant for the entry's delay D (24 h by default), and each proof that reads it expires at the change − 1 meanwhile. `merchants on` switches it back. Once it lands the account is a user: it can no longer pay users or exit as a merchant. Requests stamped for it before then stay payable by their named payers until each stamp expires, 24 h to 25 h after its opening: under 25 h after the switch-off lands, at most the delay plus 25 h after `merchants off`. That bounds stamp-reliant payments only; a merchant pays any request by its own listing.
- **Cancel**: `merchants cancel <manifest> <account>` keeps the current value; the entry stays marked until the new change time. The guardian runs it with its own secret in the admin-secret variable: the token, not the CLI, decides who may cancel.
- **Guardian**: none unless scheduled. One in office can cancel every switch-off until it is replaced, and replacing it takes the guardian slot's delay G (the delay setting, like D). So against a hostile guardian a removal lands G late if you replace it at once, and D + G late if a last-minute cancel is how you learn of it: 72 h from the first `merchants off` at the defaults.
- **Delay**: `merchants delay <manifest> <s>` sets D and syncs the merchants the node lists, in as few txs as four calls each allow. It prints how many it synced: a merchant a lagging node left out keeps its old delay until a rerun reaches it. An increase applies at once; a decrease waits old − new (24 h → 1 h takes 23 h), and merchant txs are recognisable by their expiry meanwhile.

**The 1 h option.** D = 1 h lets a switch-off land within the hour instead of a day. Its costs: every tx that proves a merchant side expires within the hour, rounded down to 30 minutes, so those txs stand out from the 23 h every other tx gets, and a slow device must prove and land a merchant tx within that window. Keep 24 h unless a day of exposure to a compromised merchant is unacceptable.

## Emergency

1. `pause <manifest> on`: instant. New claims, returns and exits on L2 are refused.
2. `merchants off <manifest> <account>`.
3. Wait D.
4. `merchants list <manifest>`: go on only if the account reads `off`. If it reads `on`, a guardian cancelled the switch-off: keep the pause, schedule a replacement (`merchants guardian <manifest> <address>`, zero for none), and repeat from step 2 once it has taken over.
5. `pause <manifest> off`.

The pause is L2-only. Token transfers on Aztec continue, withdrawals already emitted stay redeemable on Ethereum (`TokenPortal.withdraw` has no pause), and L1 deposits stay open, their messages waiting for the unpause. So it stops a bad merchant's new cash-outs, not one already in flight or its payments on Aztec.

## Demo

The demo cast's keys are public by design: they derive from the deployment (`packages/demo`), and the showcase ships them. alice and bob are users, galactica and supplier merchants; A_demo and B_demo are alice's and bob's Ethereum accounts. They hold demo funds only, never an admin or minting role, and are merchant-listed only on local and testnet.

- `demo setup <manifest>`: draws the users' tag, deploys the cast's accounts, binds alice to A_demo and bob to B_demo with their first private claims, and seeds the float with A_demo deposits (a private one alice claims, a public one galactica claims). It publishes the tag (`deployments/testnet-demo.json`, or `demo.json` beside a local manifest) and drops the deposit secrets only once every seed's claim is finalized: until then anyone holding the tag could bind a user account first, and a pruned claim needs its secret again. An interrupted setup resumes with its unpublished tag. On local it first funds A_demo and B_demo and lists the merchants itself.
- `demo setup --rotate`: a new users' tag, hence new user accounts, for a user account someone else poisoned. Merchants belong to the deployment, so nothing is re-listed.
- `demo status`: the cast's addresses, roles and balances.
- `demo reset`: galactica refunds alice back up to her seed.
- `demo fund` (keyed): refills A_demo's and B_demo's ETH and USDC, approves Permit2, and tops up the sponsor. Together they hold at most 0.02 ETH and 50 USDC.

**The acceptance run.** `smoke <manifest>`: A_demo deposits 10 privately to alice, who claims, pays a request galactica opened, gets 3 refunded, is refused a transfer to bob and an exit to B_demo with the contracts' own rule text, and withdraws 3 to A_demo on Ethereum. Each step is journaled in an owner-only state dir per deployment, so an interrupted run resumes where it stopped (the withdrawal waits up to 3 h for its epoch proof); it sends a step's tx again only once finalized blocks prove the first can never land, and until then fails with when to rerun. Ctrl-C releases the state dir; a run killed outright leaves its lock, which the next run names for you to remove. It asserts the balances' deltas from its own start (alice 0, galactica +7, A_demo −7, the portal +7), so a repeat run passes too, unless someone else moved the cast's funds meanwhile. `--record <file>` writes the tour the showcase replays.

## Showcase

- **Build.** `bun run --cwd apps/showcase build:testnet` embeds `deployments/testnet.json` and its tour `deployments/testnet-tour.json`, and refuses any override or keyed variable. Workers Builds, connected in the Cloudflare dashboard, builds a preview of each branch and production from `main`; its deploy commands are `npx wrangler@4.138.0 deploy --config apps/showcase/wrangler.jsonc` and, for other branches, `npx wrangler@4.138.0 versions upload --config apps/showcase/wrangler.jsonc` (the showcase's `deploy` and `deploy:preview` scripts run the same). wrangler is a root devDependency, so npx finds the copy `bun.lock` pins, installed with the rest of the workspace, instead of resolving its dependencies afresh, outside the lockfile and the release-age gate, with the build's Cloudflare token. A wrangler bump changes the dependency and both commands together.
- **Check what is served.** `SHOWCASE_URL=<url> bun run --cwd apps/showcase test:testnet`: the served headers, manifest and tour; the tour's txs read back from both chains; the four cheats refused live with nothing sent; galactica refunding alice 0.01, proven in the browser; A_demo depositing 0.01. That deposit stays escrowed, unclaimed: its claim ticket lived in the test's browser.
- **The float.** Visitors spend A_demo's and B_demo's USDC and gas, which `demo fund` (keyed) refills, and move alice's private balance, which `demo reset` or the page's Reset balances tops back up from galactica's. A step the float can't afford replays the recording and says so.
