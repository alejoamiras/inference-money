import type { AztecNode } from "@aztec-labs/aztec.js/node"
import type { Tx } from "@aztec-labs/stdlib/tx"

/**
 * A tx a wallet submitted, with what its kernel committed to that receipts and effects do not carry: the fee payer,
 * and the expiry with the anchor block's timestamp it counts from.
 */
export interface SentTx {
	hash: string
	feePayer: string
	expiresAt: bigint
	anchorTs: bigint
	/** The node rejected this send. It may still hold an earlier copy of the same tx. */
	refused?: true
}

/**
 * Wraps `node` so every `sendTx` through it records the tx's hash and kernel commitments before forwarding; `onSend`
 * runs then too, so a journal it writes survives a crash during the send.
 */
export function recordingNode(node: AztecNode, sent: SentTx[], onSend?: (tx: SentTx) => void): AztecNode {
	return new Proxy(node, {
		get(target, key, receiver) {
			if (key !== "sendTx") return Reflect.get(target, key, receiver)
			return (tx: Tx) => {
				const record: SentTx = {
					hash: tx.getTxHash().toString(),
					feePayer: tx.data.feePayer.toString(),
					expiresAt: tx.data.expirationTimestamp,
					anchorTs: tx.data.constants.anchorBlockHeader.globalVariables.timestamp,
				}
				sent.push(record)
				onSend?.(record)
				return target.sendTx(tx).catch((e: unknown) => {
					record.refused = true
					throw e
				})
			}
		},
	})
}
