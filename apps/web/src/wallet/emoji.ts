export { hashToEmoji } from "@aztec-labs/wallet-sdk/crypto"

/** The verification string as exactly nine cells (a 3x3 grid), split by code point so no emoji is torn in half. */
export function toGrid(emojis: string): string[] {
	const cells = Array.from(emojis).slice(0, 9)
	while (cells.length < 9) cells.push("")
	return cells
}
