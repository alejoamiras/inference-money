/**
 * A stock `@aztec-labs/wallets` embedded wallet plus the one thing a wallet-sdk wallet needs and the base class lacks: a
 * capability grant. Every bridge transaction still runs through the stock `BaseWallet` path, which is what the suite
 * tests the app against.
 */
import { type InteractionWaitOptions, NO_WAIT, type SendReturn } from "@aztec-labs/aztec.js/contracts"
import { Fq, Fr } from "@aztec-labs/aztec.js/fields"
import type { SendOptions } from "@aztec-labs/aztec.js/wallet"
import { type ExecutionPayload, PendingTxReceipt, type Tx } from "@aztec-labs/stdlib/tx"
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded"
import { sponsoredFpcArtifact, sponsorInstance } from "@inference-money/bridge-core"
import { type Grant, grantFrom } from "./guard"
import type { Seed, TestWalletIdentity } from "./profile"

type Manifest = { capabilities: Array<Record<string, unknown> & { type: string }> }

/** A transaction as this wallet handed it to the node. */
export interface SubmittedTx {
	hash: string
	feePayer: string
}

export class TestWallet extends EmbeddedWallet {
	readonly submitted: SubmittedTx[] = []
	/** What the app was last granted; undefined until it asks. */
	grant: Grant | undefined
	/** One shot: the next grant carries no contract scope, a user declining the app's contracts. */
	declineNextGrant = false
	/** One shot: the next tx is recorded but never forwarded, and the page gets a pending receipt for a hash the node never saw. */
	dropNextSubmission = false
	private imported = 0

	static async createFor(identity: TestWalletIdentity): Promise<TestWallet> {
		// Ephemeral, so nothing outlives the page; unproven, since the local network accepts fake proofs.
		const wallet = await TestWallet.create(identity.nodeUrl, { ephemeral: true, pxe: { proverEnabled: false } })
		await wallet.registerContract(await sponsorInstance(), sponsoredFpcArtifact)
		wallet.observeSubmissions()
		return wallet
	}

	async importSeed(seed: Seed): Promise<string> {
		const manager = await this.createSchnorrAccount(
			Fr.fromHexString(seed.secret),
			Fr.ZERO,
			Fq.fromHexString(seed.signingKey),
			`actor-${++this.imported}`,
		)
		return manager.address.toString()
	}

	/** Grants exactly what was asked, listing every imported account, and remembers it for enforcement. */
	// biome-ignore lint/suspicious/noExplicitAny: the SDK's manifest and grant types are zod-inferred and not exported usably.
	override async requestCapabilities(manifest: any): Promise<any> {
		const accounts = await this.getAccounts()
		const declining = this.declineNextGrant
		this.declineNextGrant = false
		const granted = (manifest as Manifest).capabilities
			.filter((c) => !(declining && c.type === "contracts"))
			.map((c) => (c.type === "accounts" ? { ...c, accounts } : c))
		this.grant = grantFrom(granted)
		return { version: "1.0", granted, wallet: { name: "USDC Bridge test wallet", version: "0.0.0" } }
	}

	/** Submissions are recorded at the node boundary, where the fee payer is final. */
	private observeSubmissions(): void {
		const node = this.aztecNode
		const observed = new Proxy(node, {
			get: (target, prop, receiver) => {
				if (prop !== "sendTx") return Reflect.get(target, prop, receiver)
				return async (tx: Tx) => {
					this.submitted.push({ hash: tx.getTxHash().toString(), feePayer: tx.data.feePayer.toString() })
					if (this.dropNextSubmission) {
						this.dropNextSubmission = false
						return
					}
					return target.sendTx(tx)
				}
			},
		})
		;(this as unknown as { aztecNode: unknown }).aztecNode = observed
	}

	override async sendTx<W extends InteractionWaitOptions = undefined>(
		payload: ExecutionPayload,
		opts: SendOptions<W>,
	): Promise<SendReturn<W>> {
		if (!this.dropNextSubmission || opts.wait === NO_WAIT) return super.sendTx(payload, opts)
		// A dropped tx never mines, so waiting on it would hang: answer pending, as a wallet whose broadcast was lost does.
		const { txHash, ...offchain } = await super.sendTx(payload, { ...opts, wait: NO_WAIT })
		return { receipt: new PendingTxReceipt(txHash, undefined), ...offchain } as unknown as SendReturn<W>
	}
}
