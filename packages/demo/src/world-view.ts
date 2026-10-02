import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import { computePublicDataTreeLeafSlot } from "@aztec-labs/stdlib/hash"
import { type BridgeManifest, tokenArtifact } from "@inference-money/bridge-core"
import type { WorldItem } from "./tour"

/** The parts of a mined tx effect anyone can read from a node. */
export interface EffectView {
	transactionFee: Fr
	noteHashes: readonly unknown[]
	nullifiers: readonly unknown[]
	l2ToL1Msgs: readonly unknown[]
	privateLogs: readonly unknown[]
	publicLogs: readonly unknown[]
	publicDataWrites: readonly { leafSlot: Fr; value: Fr }[]
}

/** What the sender's kernel committed to that the effect does not carry: the fee payer and the expiry. */
export interface Commitments {
	feePayer: string
	expiresAt: bigint
}

/** A public storage leaf the view names, such as the token's total supply. */
export interface KnownSlot {
	leafSlot: Fr
	label: string
}

const readable = (chain: WorldItem["chain"], label: string, value: string): WorldItem => ({ chain, label, value, visibility: "readable" })

/** The token's total supply leaf: claims and exits write it, so their amounts are public. */
export async function totalSupplySlot(m: BridgeManifest): Promise<KnownSlot> {
	const slot = tokenArtifact.storageLayout.total_supply?.slot
	if (!slot) throw new Error("the token artifact has no total_supply storage")
	return {
		leafSlot: await computePublicDataTreeLeafSlot(AztecAddress.fromStringUnsafe(m.l2.token.address), slot),
		label: "USDC total supply",
	}
}

/**
 * An Aztec tx as the world sees it: counts of what it created, every public write (named when the slot is known), the
 * fee payer and the expiry, all read from the chain. `hidden` names what the demo knows the tx carried but nobody else
 * can read (sender, recipient, amount); those items never carry a value.
 */
export function aztecWorld(effect: EffectView, sent: Commitments, known: readonly KnownSlot[], hidden: readonly string[]): WorldItem[] {
	const items = [
		readable("aztec", "fee payer", sent.feePayer),
		readable("aztec", "expires at", sent.expiresAt.toString()),
		readable("aztec", "fee", effect.transactionFee.toBigInt().toString()),
		readable("aztec", "nullifiers", String(effect.nullifiers.length)),
		readable("aztec", "new notes", String(effect.noteHashes.length)),
		readable("aztec", "encrypted logs", String(effect.privateLogs.length)),
	]
	let unnamed = 0
	for (const w of effect.publicDataWrites) {
		const k = known.find((s) => s.leafSlot.equals(w.leafSlot))
		if (k) items.push(readable("aztec", k.label, w.value.toBigInt().toString()))
		else unnamed++
	}
	if (unnamed > 0) items.push(readable("aztec", "other public writes", String(unnamed)))
	if (effect.publicLogs.length > 0) items.push(readable("aztec", "public logs", String(effect.publicLogs.length)))
	if (effect.l2ToL1Msgs.length > 0) items.push(readable("aztec", "messages to Ethereum", String(effect.l2ToL1Msgs.length)))
	return [...items, ...hidden.map((label): WorldItem => ({ chain: "aztec", label, visibility: "hidden" }))]
}

/** An L1 call's public fields, as its calldata and events show them. */
export const ethereumWorld = (fields: readonly [label: string, value: string][]): WorldItem[] =>
	fields.map(([label, value]) => readable("ethereum", label, value))
