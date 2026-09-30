import { type AztecNode, createAztecNodeClient } from "@aztec-labs/aztec.js/node"
import type { Tx } from "@aztec-labs/stdlib/tx"
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded"
import { withOwnedTmpDir } from "./owned-tmp"

/**
 * An ephemeral wallet; `prove: false` only for a local correctness loop. Its key stores land in TMPDIR, so open it
 * inside an owned tmp scope.
 */
export function openBridgeWallet(node: AztecNode, opts: { prove: boolean }): Promise<EmbeddedWallet> {
	return EmbeddedWallet.create(node, { ephemeral: true, pxe: { proverEnabled: opts.prove } })
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
