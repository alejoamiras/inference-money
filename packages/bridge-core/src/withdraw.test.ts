import { beforeAll, describe, expect, it } from "bun:test"
import type { Fr } from "@aztec/aztec.js/fields"
import {
	ContractFunctionExecutionError,
	ContractFunctionRevertedError,
	encodeErrorResult,
	getAddress,
	type Hex,
	type PublicClient,
	pad,
	type WalletClient,
} from "viem"
import { TOKEN_PORTAL_ABI } from "./abi"
import { type ExitTicket, expectedExitMessage } from "./exit"
import { NetworkMismatchError } from "./network"
import { fakeEpoch } from "./test/fake-epoch"
import { a, MANIFEST as M } from "./test/fixtures"
import type { L1Ctx } from "./types"
import {
	AlreadyWithdrawnError,
	buildWithdrawProof,
	finishWithdrawal,
	type OutboxProof,
	StaleProofError,
	waitWithdrawable,
	withdrawOnL1,
} from "./withdraw"

const RECIPIENT = getAddress(a(0xe1))
const ACCOUNT = getAddress(a(0xaa))
const AMOUNT = 7_000_000n
const TX: Hex = pad("0x77", { size: 32 })
const noSleep = async () => {}
let message: Fr

beforeAll(async () => {
	message = await expectedExitMessage(RECIPIENT, AMOUNT, M)
})

function setup() {
	const e = fakeEpoch([message])
	const ticket: ExitTicket = {
		l2TxHash: e.txHash,
		recipient: RECIPIENT,
		amount: AMOUNT,
		messageHash: message.toString() as Hex,
		messageIndexInTx: 0,
	}
	return { e, ticket }
}

const revert = (errorName: "Outbox__AlreadyNullified" | "MerkleLib__InvalidRoot") => {
	const args = errorName === "Outbox__AlreadyNullified" ? [5n, 2n] : [pad("0x1"), pad("0x2"), pad("0x3"), 0n]
	const data = encodeErrorResult({ abi: TOKEN_PORTAL_ABI, errorName, args } as never)
	const reverted = new ContractFunctionRevertedError({ abi: TOKEN_PORTAL_ABI, functionName: "withdraw", data })
	return new ContractFunctionExecutionError(reverted, {
		abi: TOKEN_PORTAL_ABI,
		functionName: "withdraw",
		args: [],
		contractAddress: M.l1.portal,
	})
}

/** An L1 whose successive `withdraw` simulations fail with the scripted errors, then succeed. */
function l1(simulations: (Error | undefined)[] = [], chainId = M.l1.chainId) {
	const s = { simulated: 0, writes: [] as { address: string; functionName: string; args: readonly unknown[] }[] }
	const receipt = async () => ({ status: "success" })
	const publicClient = {
		simulateContract: async () => {
			const failure = simulations[s.simulated++]
			if (failure) throw failure
			return { request: {} }
		},
		waitForTransactionReceipt: receipt,
		getTransactionReceipt: receipt,
	} as unknown as PublicClient
	const walletClient = {
		chain: undefined,
		getChainId: async () => chainId,
		getAddresses: async () => [ACCOUNT],
		writeContract: async (w: (typeof s.writes)[number]) => {
			s.writes.push(w)
			return TX
		},
	} as unknown as WalletClient
	const ctx: L1Ctx = { publicClient, walletClient, account: ACCOUNT }
	return { s, ctx }
}

describe("buildWithdrawProof", () => {
	it("proves against the Outbox's covering root, and is pending while there is none", async () => {
		const { e, ticket } = setup()
		const truth = e.truth(0)
		const proof = (await buildWithdrawProof(ticket, e.node, e.outbox)) as OutboxProof
		expect(proof).toEqual({
			epoch: BigInt(e.EPOCH),
			numCheckpointsInEpoch: 1n,
			leafIndex: truth.leafIndex,
			path: truth.siblingPath.toBufferArray().map((b) => `0x${b.toString("hex")}` as Hex),
		})

		e.state.outboxRoot = ["unproven"]
		e.state.rootReads = 0
		expect(await buildWithdrawProof(ticket, e.node, e.outbox)).toBe("pending")
	})

	it("rebuilds after a root mismatch, and gives up as stale after three", async () => {
		const { e, ticket } = setup()
		e.state.outboxRoot = ["mismatch", "proven"]
		expect(await buildWithdrawProof(ticket, e.node, e.outbox, { sleep: noSleep })).toMatchObject({ epoch: BigInt(e.EPOCH) })
		expect(e.state.rootReads).toBe(2)

		e.state.outboxRoot = ["mismatch"]
		e.state.rootReads = 0
		await expect(buildWithdrawProof(ticket, e.node, e.outbox, { sleep: noSleep })).rejects.toBeInstanceOf(StaleProofError)
		expect(e.state.rootReads).toBe(3)
	})
})

describe("waitWithdrawable", () => {
	it("reports proving until the epoch is proven, and times out keeping the ticket", async () => {
		const { e, ticket } = setup()
		e.state.outboxRoot = ["unproven", "unproven", "proven"]
		const stages: string[] = []
		await waitWithdrawable(ticket, e.node, e.outbox, (s) => stages.push(s), { sleep: noSleep })
		expect(stages).toEqual(["proving", "proving"])

		e.state.outboxRoot = ["unproven"]
		let t = 0
		const opts = { sleep: noSleep, now: () => (t += 60_000), timeoutMs: 120_000 }
		await expect(waitWithdrawable(ticket, e.node, e.outbox, undefined, opts)).rejects.toThrow(/not proven on Ethereum yet/)
	})
})

describe("withdrawOnL1", () => {
	const proof: OutboxProof = { epoch: 5n, numCheckpointsInEpoch: 1n, leafIndex: 2n, path: [pad("0x1")] }

	it("sends the 7-argument portal withdraw once the simulation passes", async () => {
		const { ticket } = setup()
		const { s, ctx } = l1()
		expect(await withdrawOnL1(ticket, proof, ctx, M)).toBe(TX)
		expect(s.writes).toEqual([
			expect.objectContaining({
				address: M.l1.portal,
				functionName: "withdraw",
				args: [RECIPIENT, AMOUNT, false, 5n, 1n, 2n, [pad("0x1")]],
			}),
		])
	})

	it.each([
		["Outbox__AlreadyNullified", AlreadyWithdrawnError],
		["MerkleLib__InvalidRoot", StaleProofError],
	] as const)("maps a %s simulation revert without sending", async (name, type) => {
		const { ticket } = setup()
		const { s, ctx } = l1([revert(name)])
		await expect(withdrawOnL1(ticket, proof, ctx, M)).rejects.toBeInstanceOf(type)
		expect(s.writes).toHaveLength(0)
	})

	it("refuses a wallet on the wrong chain before simulating", async () => {
		const { ticket } = setup()
		const { s, ctx } = l1([], 1)
		await expect(withdrawOnL1(ticket, proof, ctx, M)).rejects.toBeInstanceOf(NetworkMismatchError)
		expect(s.simulated).toBe(0)
	})
})

describe("finishWithdrawal", () => {
	it("rebuilds a proof the Outbox rejects as stale, at most three times", async () => {
		const { e, ticket } = setup()
		const once = l1([revert("MerkleLib__InvalidRoot")])
		const stages: string[] = []
		expect(await finishWithdrawal(ticket, e.node, e.outbox, once.ctx, M, (s) => stages.push(s))).toBe(TX)
		expect(stages).toEqual(["withdrawing", "withdrawing"])
		expect(e.state.rootReads).toBe(2)

		const stale = revert("MerkleLib__InvalidRoot")
		const always = l1([stale, stale, stale, stale])
		await expect(finishWithdrawal(ticket, e.node, e.outbox, always.ctx, M)).rejects.toBeInstanceOf(StaleProofError)
		expect(always.s.simulated).toBe(3)
	})
})
