import { describe, expect, it } from "bun:test"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { MANIFEST } from "../../bridge-core/src/test/fixtures"
import { parseTour, type Tour, tourHeader, tourMismatches } from "./tour"
import { aztecWorld, ethereumWorld } from "./world-view"

const step = (o: Partial<Tour["steps"][number]> = {}): Tour["steps"][number] => ({
	id: "alice-pays-bob",
	actor: "alice",
	action: "transfer",
	to: "bob",
	amount: "1000000",
	verdict: "refused",
	rule: "transfer",
	world: [],
	...o,
})

describe("tour", () => {
	it("validates a recording and checks it belongs to the manifest's deployment", () => {
		const tour = parseTour({ ...tourHeader(MANIFEST), steps: [step()] })
		expect(tourMismatches(tour, MANIFEST)).toEqual([])
		const elsewhere = { ...MANIFEST, l2: { ...MANIFEST.l2, bridge: { ...MANIFEST.l2.bridge, address: MANIFEST.l2.proxy.address } } }
		expect(tourMismatches(tour, elsewhere)).toEqual([
			`contracts.bridge ${MANIFEST.l2.bridge.address} (manifest ${MANIFEST.l2.proxy.address})`,
		])
	})

	it("refuses unknown fields, a refused step without its rule, and a settled step with one", () => {
		const header = tourHeader(MANIFEST)
		expect(() => parseTour({ ...header, steps: [step({ rule: undefined })] })).toThrow("names its rule")
		expect(() => parseTour({ ...header, steps: [step({ verdict: "settled" })] })).toThrow("names its rule")
		expect(() => parseTour({ ...header, steps: [{ ...step(), secret: "0x1" }] })).toThrow()
	})
})

describe("world view", () => {
	it("shows counts, named public writes, the payer and the expiry, and only labels what stays hidden", () => {
		const supply = { leafSlot: new Fr(7), label: "USDC total supply" }
		const effect = {
			transactionFee: new Fr(5),
			noteHashes: [1, 2],
			nullifiers: [1, 2, 3],
			l2ToL1Msgs: [1],
			privateLogs: [1, 2],
			publicLogs: [],
			publicDataWrites: [
				{ leafSlot: new Fr(7), value: new Fr(1_000_000) },
				{ leafSlot: new Fr(8), value: new Fr(1) },
			],
		}
		const world = aztecWorld(effect, { feePayer: "0xfee", expiresAt: 99n }, [supply], ["sender", "amount"])
		expect(world).toContainEqual({ chain: "aztec", label: "USDC total supply", value: "1000000", visibility: "readable" })
		expect(world).toContainEqual({ chain: "aztec", label: "other public writes", value: "1", visibility: "readable" })
		expect(world).toContainEqual({ chain: "aztec", label: "messages to Ethereum", value: "1", visibility: "readable" })
		expect(world.filter((w) => w.visibility === "hidden")).toEqual([
			{ chain: "aztec", label: "sender", visibility: "hidden" },
			{ chain: "aztec", label: "amount", visibility: "hidden" },
		])
		expect(ethereumWorld([["depositor", "0xA"]])).toEqual([
			{ chain: "ethereum", label: "depositor", value: "0xA", visibility: "readable" },
		])
	})
})
