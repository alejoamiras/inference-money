import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { openBrowserStore, PXE_DATA_SCHEMA_VERSION } from "@aztec-labs/pxe/client/lazy"
import type { Tx } from "@aztec-labs/stdlib/tx"
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded"
import { type BridgeManifest, PaymentGate, type PaymentStore, registerBridgeContracts, registerSponsor } from "@inference-money/bridge-core"
import { ACTORS, type Actor, type CastMember, castMember } from "@inference-money/demo"

/** A cast member whose account the page's wallet holds, so the page can sign as it. */
export interface Player extends CastMember {
	address: AztecAddress
}

export interface DemoWallet {
	wallet: EmbeddedWallet
	/** The node, read directly; the wallet sends through the gate's, so `payRequest` accepts it. */
	node: AztecNode
	gate: PaymentGate
	cast: Record<Actor, Player>
	/** `performance.now()` as each tx reached the node: everything before it is the page simulating and proving. */
	sentAt: number[]
}

export interface DemoWalletOptions {
	usersTag: string
	/** Real proofs, or the fake ones a local network accepts. */
	proves: boolean
	payments: PaymentStore
}

/** Opening a store another tab holds fails outright; say what to do about it. */
const POOL_BUSY = "SqlitePoolBusyError"

function stamping(node: AztecNode, sentAt: number[]): AztecNode {
	return new Proxy(node, {
		get: (target, key, receiver) =>
			key === "sendTx"
				? (tx: Tx) => {
						sentAt.push(performance.now())
						return target.sendTx(tx)
					}
				: Reflect.get(target, key, receiver),
	})
}

/** One PXE store per deployment: a redeploy on the same rollup brings new contracts and a new cast. */
async function openPxeStore(node: AztecNode, m: BridgeManifest) {
	const { l1ChainId, l1ContractAddresses } = await node.getNodeInfo()
	try {
		return await openBrowserStore(`pxe_data_${m.l2.bridge.address}`, PXE_DATA_SCHEMA_VERSION, {
			l1ChainId,
			rollupAddress: l1ContractAddresses.rollupAddress,
		})
	} catch (e) {
		if (e instanceof Error && e.name === POOL_BUSY) throw new Error("The showcase is open in another tab: close that one, then reload.")
		throw e
	}
}

/**
 * The page's one wallet, over stores that survive a reload: every cast account, the fee sponsor and the bridge's
 * contracts. Open it once per page, never per render: a second open in the same tab finds its own store locked. The
 * stores are keyed by the node's rollup, so check the node against the manifest first.
 */
export async function openDemoWallet(node: AztecNode, m: BridgeManifest, opts: DemoWalletOptions): Promise<DemoWallet> {
	const sentAt: number[] = []
	const store = await openPxeStore(node, m)
	const gate = new PaymentGate(stamping(node, sentAt), opts.payments)
	const wallet = await gate.bindWallet((gated) => EmbeddedWallet.create(gated, { pxe: { proverEnabled: opts.proves, store } }))
	await registerSponsor(wallet, m)
	await registerBridgeContracts(wallet, m)
	const cast = {} as Record<Actor, Player>
	for (const actor of ACTORS) {
		const member = castMember(m, actor, opts.usersTag)
		// Repeats safely on reload: an account the store already holds is not registered again.
		const account = await wallet.createSchnorrAccount(member.secret, Fr.ZERO, member.signingKey, actor)
		cast[actor] = { ...member, address: account.address }
	}
	return { wallet, node, gate, cast, sentAt }
}
