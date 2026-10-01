/**
 * L1<->L2 message content hashes, byte-identical to the portal's `Hash.sha256ToField(abi.encodeWithSignature(...))` and
 * the Noir bridge: a drift makes a deposit's message unconsumable. The same literal vectors pin all three toolchains.
 *
 * `sha256ToField(data) = uint256(sha256(data)) >> 8`, so every hash starts with a zero byte (it fits the BN254 field).
 */

// keccak256(signature)[:4]
const SELECTOR = {
	mintToPublic: "05829b7e", // mint_to_public(bytes32,uint256,address)
	mintToPrivate: "69248b42", // mint_to_private(uint256,address)
	withdraw: "69328dec", // withdraw(address,uint256,address)
} as const

function strip0x(h: string): string {
	return h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h
}

function word(hex: string): string {
	return strip0x(hex).toLowerCase().padStart(64, "0")
}

function wordFromBigInt(n: bigint): string {
	return n.toString(16).padStart(64, "0")
}

function bytesFromHex(hex: string): Uint8Array<ArrayBuffer> {
	const clean = strip0x(hex)
	const out = new Uint8Array(new ArrayBuffer(clean.length / 2))
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	return out
}

async function sha256ToField(data: Uint8Array<ArrayBuffer>): Promise<`0x${string}`> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
	let hex = ""
	for (const b of digest) hex += b.toString(16).padStart(2, "0")
	return `0x00${hex.slice(0, 62)}`
}

/** Public mint: the recipient (an Aztec address as bytes32) and the L1 depositor are bound in the hash. */
export function mintToPublicContentHash(toBytes32: string, amount: bigint, depositor: string): Promise<`0x${string}`> {
	return sha256ToField(bytesFromHex(SELECTOR.mintToPublic + word(toBytes32) + wordFromBigInt(amount) + word(depositor)))
}

/** Private mint: the L1 depositor is bound in the hash; `claim_private` binds the recipient through the claim secret. */
export function mintToPrivateContentHash(amount: bigint, depositor: string): Promise<`0x${string}`> {
	return sha256ToField(bytesFromHex(SELECTOR.mintToPrivate + wordFromBigInt(amount) + word(depositor)))
}

/** L2->L1 withdraw; `recipient` and `caller` are L1 addresses (`caller` zero = anyone may submit). */
export function withdrawContentHash(recipient: string, amount: bigint, caller: string): Promise<`0x${string}`> {
	return sha256ToField(bytesFromHex(SELECTOR.withdraw + word(recipient) + wordFromBigInt(amount) + word(caller)))
}
