import { describe, expect, it, mock } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import * as core from "@inference-money/bridge-core"

/** Every Permit2 approval castDeposit asked for; nothing past it runs, since the signer cannot read a block. */
const approvals: bigint[] = []
/** The private recipient's funding address; none until its first claim. */
let bound: `0x${string}` | undefined
mock.module("@inference-money/bridge-core", () => ({
	...core,
	syncMerchantList: async () => ({ block: 1, at: 0n, entries: new Map() }),
	fundingAddress: async () => bound,
	ensurePermit2Allowance: async (a: { needed: bigint }) => {
		approvals.push(a.needed)
	},
}))
const { castDeposit } = await import("./flows")

describe("castDeposit", () => {
	it("refuses a deposit that could only be returned before any approval, and lets one the recipient can claim on", async () => {
		const signer = {
			account: { address: "0x0000000000000000000000000000000000000001" },
			publicClient: {
				getBlock: () => Promise.reject(new Error("past the approval")),
			},
		} as never
		const s = { m: { l2: { token: { address: AztecAddress.ZERO.toString() } } }, node: {} } as never
		const to = await AztecAddress.random()
		const plan = (kind: "public" | "private") => ({ from: "alice", to, kind, amount: 5n }) as const
		await expect(castDeposit(s, signer, plan("public"), undefined, () => {})).rejects.toBeInstanceOf(core.PublicDepositToUserError)
		bound = "0x0000000000000000000000000000000000000002"
		await expect(castDeposit(s, signer, plan("private"), undefined, () => {})).rejects.toBeInstanceOf(core.NotFundingAddressError)
		expect(approvals).toEqual([])
		bound = undefined
		await expect(castDeposit(s, signer, plan("private"), undefined, () => {})).rejects.toThrow("past the approval")
		bound = "0x0000000000000000000000000000000000000001"
		await expect(castDeposit(s, signer, plan("private"), undefined, () => {})).rejects.toThrow("past the approval")
		expect(approvals).toEqual([5n, 5n])
	})
})
