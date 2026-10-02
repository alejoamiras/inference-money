import { describe, expect, it, mock } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import * as core from "@inference-money/bridge-core"

/** Every Permit2 approval castDeposit asked for; nothing past it runs, since the signer cannot read a block. */
const approvals: bigint[] = []
mock.module("@inference-money/bridge-core", () => ({
	...core,
	syncMerchantList: async () => ({ block: 1, at: 0n, entries: new Map() }),
	ensurePermit2Allowance: async (a: { needed: bigint }) => {
		approvals.push(a.needed)
	},
}))
const { castDeposit } = await import("./flows")

describe("castDeposit", () => {
	it("refuses a public deposit to anyone the merchant list doesn't name before any approval, and lets a private one on", async () => {
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
		expect(approvals).toEqual([])
		await expect(castDeposit(s, signer, plan("private"), undefined, () => {})).rejects.toThrow("past the approval")
		expect(approvals).toEqual([5n])
	})
})
