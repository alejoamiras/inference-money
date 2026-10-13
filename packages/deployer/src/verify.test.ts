import { describe, expect, it } from "bun:test"
import { type Address, type Hex, type PublicClient, TransactionNotFoundError } from "viem"
import { type CreationWant, createdAsBuilt, creationCheck } from "./verify"

const DEPLOYER: Address = "0x00000000000000000000000000000000000000d0"
const CREATED: Address = "0x00000000000000000000000000000000000000c0"
const WANT: CreationWant = { deployer: DEPLOYER, input: "0x6080aa", address: CREATED, block: 5n }
const HASH: Hex = `0x${"ab".repeat(32)}`
const TX: { hash: Hex; to: Address | null; from: Address; input: Hex } = { hash: HASH, to: null, from: DEPLOYER, input: "0x6080aa" }
const RECEIPT: { status: "success" | "reverted"; contractAddress: Address; blockNumber: bigint } = {
	status: "success",
	contractAddress: CREATED,
	blockNumber: 5n,
}

describe("creationCheck", () => {
	it("passes the deployer's plain create of the fresh build's init code, at the manifest's address and block", () => {
		expect(creationCheck("c", TX, RECEIPT, WANT)).toEqual({ name: "c", ok: true, detail: HASH })
	})

	it.each<[string, Partial<typeof TX>, Partial<typeof RECEIPT>, string]>([
		["a call through another contract", { to: "0x00000000000000000000000000000000000000f0" }, {}, "not a creation"],
		["another sender", { from: "0x00000000000000000000000000000000000000e0" }, {}, "sent by"],
		["other init code with the same runtime", { input: "0x6080aa00" }, {}, "init code differs"],
		["a reverted create", {}, { status: "reverted" }, "reverted"],
		["another created address", {}, { contractAddress: "0x00000000000000000000000000000000000000c1" }, "created 0x"],
		["a block other than the recorded one", {}, { blockNumber: 6n }, "mined in 6, not 5"],
	])("fails %s, and says what differs", (_, tx, receipt, says) => {
		const c = creationCheck("c", { ...TX, ...tx }, { ...RECEIPT, ...receipt }, WANT)
		expect([c.ok, c.detail]).toEqual([false, expect.stringContaining(says)])
	})
})

describe("createdAsBuilt", () => {
	const unread = {} as PublicClient

	it("warns, and reads nothing, when the manifest records no creation tx", async () => {
		expect(await createdAsBuilt(unread, "portal", undefined, WANT)).toMatchObject({ ok: true, warn: true })
	})

	it("fails a creation tx the endpoint cannot find, naming the flag that picks another endpoint", async () => {
		const pruned = {
			getTransaction: async () => {
				throw new TransactionNotFoundError({ hash: HASH })
			},
			getTransactionReceipt: async () => RECEIPT,
		} as unknown as PublicClient
		const c = await createdAsBuilt(pruned, "portal", HASH, WANT)
		expect([c.ok, c.detail]).toEqual([false, expect.stringContaining("--l1-rpc")])
	})
})
