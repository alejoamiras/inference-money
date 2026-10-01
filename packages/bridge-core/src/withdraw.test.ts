import { beforeAll, describe, expect, it } from "bun:test"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import {
	type Address,
	ContractFunctionExecutionError,
	ContractFunctionRevertedError,
	encodeAbiParameters,
	encodeErrorResult,
	encodeEventTopics,
	getAddress,
	type Hex,
	type Log,
	type PublicClient,
	pad,
	TransactionNotFoundError,
	type WalletClient,
} from "viem"
import { OUTBOX_ABI, TOKEN_PORTAL_ABI } from "./abi"
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

type Write = { address: string; functionName: string; args: readonly unknown[]; chain: { id: number } }

/** The Outbox's event for the leaf a sent `withdraw` names, as its receipt carries it. */
function consumedLog(w: Write, messageHash: Hex, outbox: Address = M.l1.outbox): Log {
	const [, , , epoch, n, leafIndex, path] = w.args as [unknown, unknown, unknown, bigint, bigint, bigint, Hex[]]
	return {
		address: outbox,
		topics: encodeEventTopics({ abi: OUTBOX_ABI, eventName: "MessageConsumed", args: { epoch, root: pad("0x9"), messageHash } }) as [
			Hex,
			...Hex[],
		],
		data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2n ** BigInt(path.length) + leafIndex, n]),
	} as Log
}

/**
 * An L1 whose successive `withdraw` simulations fail with the scripted errors, then succeed. A mined withdraw's receipt
 * carries the Outbox event for `message` unless `s.minedLogs` scripts it (a replacement mined instead).
 */
function l1(simulations: (Error | undefined)[] = [], chainId = M.l1.chainId) {
	const s = {
		simulated: 0,
		writes: [] as Write[],
		minedHash: TX,
		minedLogs: undefined as ((w: Write) => Log[]) | undefined,
	}
	const receipt = async () => {
		const w = s.writes.at(-1) as Write
		return {
			status: "success",
			transactionHash: s.minedHash,
			logs: (s.minedLogs ?? ((x) => [consumedLog(x, message.toString() as Hex)]))(w),
		}
	}
	const publicClient = {
		simulateContract: async () => {
			const failure = simulations[s.simulated++]
			if (failure) throw failure
			return { request: {} }
		},
		estimateContractGas: async () => 200_000n,
		waitForTransactionReceipt: receipt,
		getTransactionReceipt: receipt,
	} as unknown as PublicClient
	const walletClient = {
		chain: undefined,
		getChainId: async () => chainId,
		getAddresses: async () => [ACCOUNT],
		writeContract: async (w: Write) => {
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
	const proven = async () => {
		const { e, ticket } = setup()
		return { ticket, proof: (await buildWithdrawProof(ticket, e.node, e.outbox)) as OutboxProof }
	}

	it("sends the 7-argument portal withdraw on the manifest's chain, with gas headroom, once the simulation passes", async () => {
		const { ticket, proof } = await proven()
		const { s, ctx } = l1()
		expect(await withdrawOnL1(ticket, proof, ctx, M)).toBe(TX)
		expect(s.writes).toEqual([
			expect.objectContaining({
				address: M.l1.portal,
				functionName: "withdraw",
				args: [RECIPIENT, AMOUNT, false, proof.epoch, proof.numCheckpointsInEpoch, proof.leafIndex, [...proof.path]],
				gas: 300_000n,
				chain: expect.objectContaining({ id: M.l1.chainId }),
			}),
		])
	})

	it("returns the mined hash only when the receipt holds the Outbox's event for this leaf", async () => {
		const { ticket, proof } = await proven()
		const sped = l1()
		sped.s.minedHash = pad("0x5bed", { size: 32 })
		expect(await withdrawOnL1(ticket, proof, sped.ctx, M)).toBe(sped.s.minedHash)
		const msg = ticket.messageHash
		for (const minedLogs of [
			() => [],
			(w: Write) => [consumedLog(w, msg, getAddress(a(0x0b)))],
			(w: Write) => [consumedLog({ ...w, args: [...w.args.slice(0, 5), 3n, w.args[6]] }, msg)],
		]) {
			const cancelled = l1()
			cancelled.s.minedLogs = minedLogs
			await expect(withdrawOnL1(ticket, proof, cancelled.ctx, M)).rejects.toThrow("without this withdrawal")
		}
	})

	it("refuses, before touching L1, a proof not built for this exit and an exit whose payout fields lost their message", async () => {
		const { ticket, proof } = await proven()
		const { s, ctx } = l1()
		const otherOccurrence = { ...ticket, messageIndexInTx: 1 }
		await expect(withdrawOnL1(otherOccurrence, proof, ctx, M)).rejects.toThrow("not built for this withdrawal")
		await expect(withdrawOnL1(ticket, { ...proof, leafIndex: 3n }, ctx, M)).rejects.toThrow("not built for this withdrawal")
		const redirected = { ...ticket, recipient: getAddress(a(0xe2)) }
		await expect(withdrawOnL1(redirected, proof, ctx, M)).rejects.toThrow("does not match its message")
		expect(s.simulated).toBe(0)
	})

	it("records a proof for the exit it was computed from, even if the ticket changes while it builds", async () => {
		const { e, ticket } = setup()
		const building = buildWithdrawProof(ticket, e.node, e.outbox)
		ticket.messageIndexInTx = 1
		const proof = (await building) as OutboxProof
		const { ctx } = l1()
		await expect(withdrawOnL1(ticket, proof, ctx, M)).rejects.toThrow("not built for this withdrawal")
		expect(await withdrawOnL1({ ...ticket, messageIndexInTx: 0 }, proof, ctx, M)).toBe(TX)
	})

	it("keeps waiting on a sent withdraw while L1 still has it, and fails only once it is gone", async () => {
		const { ticket, proof } = await proven()
		const quick = { receipt: { attempts: 1, attemptTimeoutMs: 1, waitMs: async () => {} } }
		const script = (ctx: L1Ctx, o: { rounds: () => Promise<unknown>; known: () => Promise<unknown> }) => {
			Object.assign(ctx.publicClient, {
				waitForTransactionReceipt: o.rounds,
				getTransactionReceipt: () => Promise.reject(new Error("not yet")),
				getTransaction: o.known,
			})
		}
		const slow = l1()
		const mined = slow.ctx.publicClient.waitForTransactionReceipt as () => Promise<unknown>
		let rounds = 0
		script(slow.ctx, { rounds: async () => (++rounds < 3 ? Promise.reject(new Error("timeout")) : mined()), known: async () => ({}) })
		expect(await withdrawOnL1(ticket, proof, slow.ctx, M, quick)).toBe(TX)
		expect(rounds).toBe(3)

		const flaky = l1()
		const flakyMined = flaky.ctx.publicClient.waitForTransactionReceipt as () => Promise<unknown>
		let flakyRounds = 0
		let lookups = 0
		script(flaky.ctx, {
			rounds: async () => (++flakyRounds < 4 ? Promise.reject(new Error("timeout")) : flakyMined()),
			known: async () => (++lookups % 2 === 1 ? Promise.reject(new TransactionNotFoundError({ hash: TX })) : {}),
		})
		expect(await withdrawOnL1(ticket, proof, flaky.ctx, M, quick), "one lookup missing it is not gone").toBe(TX)

		const gone = l1()
		let goneRounds = 0
		script(gone.ctx, {
			rounds: () => {
				goneRounds++
				return Promise.reject(new Error("timeout"))
			},
			known: () => Promise.reject(new TransactionNotFoundError({ hash: TX })),
		})
		let clock = 0
		const minutes = { ...quick, now: () => clock++ * 60_000 }
		await expect(withdrawOnL1(ticket, proof, gone.ctx, M, minutes)).rejects.toThrow("most likely dropped")
		expect(goneRounds, "two misses alone are not enough: 30 minutes must pass too").toBeGreaterThan(29)
		expect(gone.s.writes).toHaveLength(1)
	})

	it.each([
		["Outbox__AlreadyNullified", AlreadyWithdrawnError],
		["MerkleLib__InvalidRoot", StaleProofError],
	] as const)("maps a %s simulation revert without sending", async (name, type) => {
		const { ticket, proof } = await proven()
		const { s, ctx } = l1([revert(name)])
		await expect(withdrawOnL1(ticket, proof, ctx, M)).rejects.toBeInstanceOf(type)
		expect(s.writes).toHaveLength(0)
	})

	it("refuses a wallet on the wrong chain before simulating", async () => {
		const { ticket, proof } = await proven()
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
