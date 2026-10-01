/**
 * The merchant list as a client sees it, and the side capsule every restricted token call carries.
 *
 * A restricted call (a private transfer, a request opening, a payment) proves one side a merchant. The token's hint
 * picks which side from the tx's capsule, else by probing the node about each account; a wrong pick only fails the
 * proof. So clients attach the capsule, computed here from a list synced whole: every `MerchantAdded` event, then
 * every entry's switch-off state read at one block. Reading only the entries a call involves would tell the node whom
 * the client transacts with.
 */
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { getPublicEvents } from "@aztec-labs/aztec.js/events"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { BlockNumber } from "@aztec-labs/foundation/branded-types"
import { type AbiType, decodeFunctionSignature, type EventMetadataDefinition, EventSelector } from "@aztec-labs/stdlib/abi"
import { DelayedPublicMutableValues } from "@aztec-labs/stdlib/delayed-public-mutable"
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash"
import { Capsule } from "@aztec-labs/stdlib/tx"
import { tokenArtifact } from "./artifacts"
import { type TokenRule, tokenRefusalOf } from "./rules"
import { MERCHANT_SIDE_SLOT } from "./stamp"

/** Which side a restricted call proves, as the token's hint numbers them: its first account, its second, or none. */
export const Side = { First: 0, Second: 1, Neither: 2 } as const
export type Side = (typeof Side)[keyof typeof Side]

/** An entry's switch-off state: `off` holds before `changeAt`, `scheduledOff` from then on. */
export interface MerchantEntry {
	off: boolean
	scheduledOff: boolean
	changeAt: bigint
}

/** Every listed account's entry, read at `block`, whose timestamp is `at`. */
export interface MerchantList {
	block: number
	at: bigint
	entries: ReadonlyMap<string, MerchantEntry>
}

export type MerchantNode = Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getPublicStorageAt" | "getPublicLogsByTags">

type StructType = Extract<AbiType, { kind: "struct" }>

/** A token event's decoding definition, its selector derived the way aztec's codegen derives it. */
export async function tokenEvent(name: string): Promise<EventMetadataDefinition> {
	const path = `Token::${name}`
	const abiType = (tokenArtifact.outputs.structs.events as StructType[] | undefined)?.find((e) => e.path === path)
	if (!abiType) throw new Error(`the token artifact has no ${path} event`)
	const signature = decodeFunctionSignature(
		name,
		abiType.fields.map((f) => ({ ...f, visibility: "private" as const })),
	)
	return { eventSelector: await EventSelector.fromSignature(signature), abiType, fieldNames: abiType.fields.map((f) => f.name) }
}

async function listedAccounts(node: MerchantNode, token: AztecAddress, block: number): Promise<AztecAddress[]> {
	const added = await tokenEvent("MerchantAdded")
	const accounts: AztecAddress[] = []
	let afterEvent: Parameters<typeof getPublicEvents>[2]["afterEvent"]
	do {
		const page = await getPublicEvents<{ account: AztecAddress }>(node as AztecNode, added, {
			contractAddress: token,
			toBlock: BlockNumber(block + 1),
			afterEvent,
		})
		accounts.push(...page.events.map((e) => e.event.account))
		afterEvent = page.nextCursor
	} while (afterEvent)
	return accounts
}

function storageSlot(field: string): Fr {
	const layout = tokenArtifact.storageLayout[field]
	if (!layout) throw new Error(`the token artifact has no ${field} storage`)
	return layout.slot
}

/** Every listed merchant's entry at the latest block (or `block`), each read at that block. */
export async function syncMerchantList(node: MerchantNode, token: AztecAddress, block?: number): Promise<MerchantList> {
	const at = block ?? Number(await node.getBlockNumber())
	const data = await node.getBlockData(BlockNumber(at))
	if (!data) throw new Error(`The node has no block ${at}.`)
	const offSlot = storageSlot("merchant_off")
	const accounts = await listedAccounts(node, token, at)
	const entries = await Promise.all(
		accounts.map(async (account): Promise<[string, MerchantEntry]> => {
			const slot = await deriveStorageSlotInMap(offSlot, account)
			const { svc } = await DelayedPublicMutableValues.readFromTree(slot, (s) => node.getPublicStorageAt(BlockNumber(at), token, s))
			return [
				account.toString(),
				{ off: !svc.previous[0]!.isZero(), scheduledOff: !svc.post[0]!.isZero(), changeAt: svc.timestampOfChange },
			]
		}),
	)
	return { block: at, at: data.header.globalVariables.timestamp, entries: new Map(entries) }
}

/** Whether `account` is a switched-on merchant at `at`, and whether its entry has a change scheduled after `at`. */
export function merchantStatus(list: MerchantList, account: AztecAddress, at = list.at): { merchant: boolean; pending: boolean } {
	const e = list.entries.get(account.toString())
	if (!e) return { merchant: false, pending: false }
	return { merchant: !(at < e.changeAt ? e.off : e.scheduledOff), pending: e.changeAt > at }
}

/**
 * The side a transfer or request proves, by the token hint's rules: a merchant side is always kept; opening a
 * request, a merchant recipient is always proven (so its request is stamped); otherwise, of two merchants, the one
 * with no change pending, whose read keeps the tx's expiry longest. `first` is the recipient, `second` the sender.
 */
export function merchantSide(list: MerchantList, first: AztecAddress, second: AztecAddress, opening: boolean): Side {
	const a = merchantStatus(list, first)
	if (a.merchant && (opening || !a.pending)) return Side.First
	const b = merchantStatus(list, second)
	if (b.merchant && (!a.merchant || !b.pending)) return Side.Second
	return a.merchant ? Side.First : Side.Neither
}

/** The side a payment into a request proves: its stamp, which reads no entry, before the payer. */
export function paymentSide(list: MerchantList, stamped: boolean, from: AztecAddress): Side {
	if (stamped) return Side.First
	return merchantStatus(list, from).merchant ? Side.Second : Side.Neither
}

/** The capsule that tells the token which side to prove; one serves every restricted call in its tx. */
export const sideCapsule = (token: AztecAddress, side: Side): Capsule => new Capsule(token, MERCHANT_SIDE_SLOT, [new Fr(side)])

// The refusals a stale list can cause: it named a side that is no longer a merchant, or missed one that now is.
const STALE_LIST_RULES: ReadonlySet<TokenRule> = new Set(["transfer", "request", "payment", "notRegistered", "switchedOff"])

/** Runs `attempt` on `list`; when it fails on a merchant rule and `resync` is given, retries once on a fresh list. */
export async function withFreshList<T>(
	list: MerchantList,
	resync: (() => Promise<MerchantList>) | undefined,
	attempt: (list: MerchantList) => Promise<T>,
): Promise<T> {
	try {
		return await attempt(list)
	} catch (e) {
		const rule = tokenRefusalOf(e)
		if (!resync || !rule || !STALE_LIST_RULES.has(rule)) throw e
		return attempt(await resync())
	}
}
