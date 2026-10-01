import type { Address } from "viem"
import type { Holder } from "@/tour/player"
import { shortHex } from "./format"
import type { Card } from "./Stage"

/** Left to right as the stage lays them out. */
export const ETHEREUM_HOLDERS = ["B_demo", "portal", "A_demo"] as const
export const AZTEC_HOLDERS = ["alice", "bob", "galactica", "supplier"] as const

export const HOLDER_NAME: Record<Holder, string> = {
	A_demo: "Alice's wallet",
	B_demo: "Bob's wallet",
	portal: "Portal",
	alice: "Alice",
	bob: "Bob",
	galactica: "Galactica",
	supplier: "Supplier",
}

const FUNDED_BY = { alice: "A_demo", bob: "B_demo" } as const

/** Every card on the stage, each showing `figure(holder)`; `caption` says what the Aztec figures are. */
export function stageCards(
	wallets: Record<"A_demo" | "B_demo", Address>,
	figure: (h: Holder) => string,
	caption: string,
): { ethereum: Card[]; aztec: Card[] } {
	const ethereum = ETHEREUM_HOLDERS.map(
		(h): Card => ({ holder: h, name: HOLDER_NAME[h], sub: h === "portal" ? "USDC escrow" : shortHex(wallets[h]), figure: figure(h) }),
	)
	const aztec = AZTEC_HOLDERS.map((h): Card => {
		const base = { holder: h, name: HOLDER_NAME[h], sub: caption, figure: figure(h) }
		if (h === "alice" || h === "bob") return { ...base, role: "user", foot: `bound to ${shortHex(wallets[FUNDED_BY[h]])}` }
		return { ...base, role: "merchant", foot: "withdraws anywhere" }
	})
	return { ethereum, aztec }
}
