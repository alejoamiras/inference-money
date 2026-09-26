import { type AztecNode, createAztecNodeClient } from "@aztec/aztec.js/node"
import type { Tx } from "@aztec/stdlib/tx"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { authorizeLegacyHandshakeReads, registerLegacyHandshakeRegistry } from "@inference-money/bridge-core"
import { withOwnedTmpDir } from "./owned-tmp"

/**
 * An ephemeral wallet that can execute the 5.0.0 sponsor (see bridge-core's compat). `prove: false` only for a local
 * correctness loop. Its key stores land in TMPDIR, so open it inside an owned tmp scope.
 */
export async function openBridgeWallet(node: AztecNode, opts: { prove: boolean }): Promise<EmbeddedWallet> {
	const wallet = await EmbeddedWallet.create(node, {
		ephemeral: true,
		pxe: { proverEnabled: opts.prove, hooks: { authorizeUtilityCall: authorizeLegacyHandshakeReads } },
	})
	try {
		await registerLegacyHandshakeRegistry(wallet)
		return wallet
	} catch (e) {
		await wallet.stop()
		throw e
	}
}

/** {@link openBridgeWallet} inside an owned tmp scope, stopped before the scope's dir is removed. */
export function withBridgeWallet<T>(nodeUrl: string, opts: { prove: boolean }, fn: (w: EmbeddedWallet, node: AztecNode) => Promise<T>) {
	return withOwnedTmpDir(async () => {
		const node = createAztecNodeClient(nodeUrl)
		const wallet = await openBridgeWallet(node, opts)
		try {
			return await fn(wallet, node)
		} finally {
			await wallet.stop()
		}
	})
}

/** A tx a wallet submitted, with the fee payer its kernel committed to (receipts and effects do not carry it). */
export interface SentTx {
	hash: string
	feePayer: string
}

/** Wraps `node` so every `sendTx` through it records the tx's hash and committed fee payer before forwarding. */
export function recordingNode(node: AztecNode, sent: SentTx[]): AztecNode {
	return new Proxy(node, {
		get(target, key, receiver) {
			if (key !== "sendTx") return Reflect.get(target, key, receiver)
			return (tx: Tx) => {
				sent.push({ hash: tx.getTxHash().toString(), feePayer: tx.data.feePayer.toString() })
				return target.sendTx(tx)
			}
		},
	})
}
