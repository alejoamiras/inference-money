import { describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { TxHash, TxStatus } from "@aztec-labs/aztec.js/tx"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import type { ExecutionPayload, Tx } from "@aztec-labs/stdlib/tx"
import type { MerchantList } from "./merchants"
import {
	memoryPaymentStore,
	openedCommitment,
	PaymentGate,
	type PaymentIntent,
	PaymentRefusedError,
	type PaymentStore,
	paymentKey,
	payRequest,
	RESERVATION_TTL_MS,
	siloedCompletionTag,
} from "./payments"
import { TOKEN_REFUSALS } from "./rules"
import { REQUEST_OPENED_EFFECT, siloedRequestMarks } from "./stamp"
import { MANIFEST } from "./test/fixtures"

const token = await AztecAddress.random()
const [merchant, alice] = await Promise.all([AztecAddress.random(), AztecAddress.random()])
const LIST: MerchantList = {
	block: 1,
	at: 0n,
	entries: new Map([[merchant.toString(), { off: false, scheduledOff: false, changeAt: 0n }]]),
}

const receipt = (status: TxStatus) => ({
	status,
	isMined: () => [TxStatus.PROPOSED, TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED].includes(status),
	isPending: () => status === TxStatus.PENDING,
	isDropped: () => status === TxStatus.DROPPED,
	hasExecutionSucceeded: () => true,
	hasExecutionReverted: () => false,
})

/** One chain: a tx sent through any node is included at once unless `lose` drops it; its completion is then on chain. */
function fakeChain() {
	const chain = {
		ts: 1_000n,
		lose: false,
		included: [] as Tx[],
		receipts: new Map<string, TxStatus>(),
		stamps: new Set<string>(),
		completions: new Set<string>(),
	}
	const node = {
		sendTx: async (tx: Tx) => {
			if (chain.lose) return
			chain.included.push(tx)
			chain.receipts.set(tx.getTxHash().toString(), TxStatus.CHECKPOINTED)
			for (const log of tx.data.getNonEmptyPrivateLogs()) chain.completions.add(log.fields[0].toString())
		},
		getTxReceipt: async (h: TxHash) => receipt(chain.receipts.get(h.toString()) ?? TxStatus.DROPPED),
		getBlockData: async () => ({ header: { globalVariables: { timestamp: chain.ts } } }),
		findLeavesIndexes: async (_b: unknown, _t: unknown, [n]: Fr[]) => [chain.stamps.has(n!.toString()) ? { data: 0n } : undefined],
		getPrivateLogsByTags: async ({ tags }: { tags: { value: Fr }[] }) => [chain.completions.has(tags[0]!.value.toString()) ? [{}] : []],
		getPublicLogsByTags: async () => [[]],
	} as unknown as AztecNode
	return { chain, node }
}

type Hooks = { beforeSend?: () => Promise<void> | void; afterSend?: () => void }

/** A wallet whose send proves a private payment into the call's commitment and hands it to `node` (its gate's). */
function fakePayer(node: AztecNode, ts: () => bigint, hooks: Hooks = {}): Wallet {
	return {
		getChainInfo: async () => ({ chainId: new Fr(MANIFEST.l1.chainId), version: new Fr(MANIFEST.l2.rollupVersion) }),
		sendTx: async (p: ExecutionPayload, opts?: { wait?: unknown }) => {
			await hooks.beforeSend?.()
			const tag = await siloedCompletionTag(token, p.calls[0]!.args[1]!)
			const txHash = TxHash.random()
			const tx = {
				getTxHash: () => txHash,
				data: { expirationTimestamp: ts() + 86_399n, getNonEmptyPrivateLogs: () => [{ fields: [tag] }] },
				publicFunctionCalldata: [],
			} as unknown as Tx
			await node.sendTx(tx)
			hooks.afterSend?.()
			return opts?.wait === NO_WAIT ? { txHash, offchainEffects: [], offchainMessages: [] } : { receipt: { txHash } }
		},
	} as unknown as Wallet
}

async function stampedRequest(chain: ReturnType<typeof fakeChain>["chain"]): Promise<Fr> {
	const commitment = Fr.random()
	chain.stamps.add((await siloedRequestMarks(token, commitment)).stamp.toString())
	return commitment
}

const pay = (commitment: Fr, from = alice): PaymentIntent => ({ from, commitment, amount: 5n, kind: "private" })

/** A tab: its own gate and wallet over the shared store and chain. */
function tab(store: PaymentStore, w: ReturnType<typeof fakeChain>, hooks?: Hooks, now?: () => number) {
	const gate = new PaymentGate(w.node, store, now)
	const wallet = fakePayer(gate.node, () => w.chain.ts, hooks)
	return { gate, pay: (c: Fr, from?: AztecAddress) => payRequest(gate, wallet, token, pay(c, from), { list: LIST }) }
}

const refusal = (reason: string) => expect.objectContaining({ name: "PaymentRefusedError", reason })

describe("payRequest", () => {
	it("pays once, then refuses the same request from this client", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const c = await stampedRequest(w.chain)
		const t = tab(store, w)
		await t.pay(c)
		expect(w.chain.included).toHaveLength(1)
		expect((await store.get(paymentKey(token, c)))?.state).toBe("sent")
		await expect(t.pay(c)).rejects.toEqual(refusal("in-flight"))
		w.chain.receipts.set(w.chain.included[0]!.getTxHash().toString(), TxStatus.FINALIZED)
		await expect(t.pay(c)).rejects.toEqual(refusal("paid"))
		expect(w.chain.included).toHaveLength(1)
	})

	it("lets exactly one of two tabs pay, refusing the other before it proves", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const c = await stampedRequest(w.chain)
		const results = await Promise.allSettled([tab(store, w).pay(c), tab(store, w).pay(c)])
		expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"])
		expect(results.find((r) => r.status === "rejected")).toEqual({ status: "rejected", reason: refusal("in-flight") })
		expect(w.chain.included).toHaveLength(1)
	})

	it("after a reload mid-payment, keeps the request blocked until the chain passes the lost tx's expiry", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const c = await stampedRequest(w.chain)
		w.chain.lose = true
		const closed = tab(store, w, {
			afterSend: () => {
				throw new Error("tab closed")
			},
		})
		await expect(closed.pay(c)).rejects.toThrow("tab closed")
		w.chain.lose = false
		const reloaded = tab(store, w)
		await expect(reloaded.pay(c)).rejects.toEqual(refusal("in-flight"))
		w.chain.ts += 86_399n
		await expect(reloaded.pay(c)).rejects.toEqual(refusal("in-flight"))
		w.chain.ts += 1n
		await reloaded.pay(c)
		expect(w.chain.included).toHaveLength(1)
	})

	it("releases the request when the payment fails before it is sent", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const c = await stampedRequest(w.chain)
		const failing = tab(store, w, {
			beforeSend: () => {
				throw new Error("Simulation error: Balance too low")
			},
		})
		await expect(failing.pay(c)).rejects.toThrow("Balance too low")
		expect(await store.get(paymentKey(token, c))).toBeUndefined()
		await tab(store, w).pay(c)
		expect(w.chain.included).toHaveLength(1)
	})

	it("never lets an abandoned reservation reach the node once another tab took it over", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const c = await stampedRequest(w.chain)
		let ms = 0
		let resume = () => {}
		const proving = new Promise<void>((r) => {
			resume = r
		})
		const slow = tab(store, w, { beforeSend: () => proving }, () => ms)
		const first = slow.pay(c)
		await Bun.sleep(10)
		ms += RESERVATION_TTL_MS + 1
		await tab(store, w, undefined, () => ms).pay(c)
		resume()
		await expect(first).rejects.toBeInstanceOf(PaymentRefusedError)
		expect(w.chain.included).toHaveLength(1)
	})

	it("refuses a request already completed on chain, and a user paying an unstamped one, before proving", async () => {
		const w = fakeChain()
		const store = memoryPaymentStore()
		const paid = await stampedRequest(w.chain)
		w.chain.completions.add((await siloedCompletionTag(token, paid)).toString())
		await expect(tab(store, w).pay(paid)).rejects.toEqual(refusal("completed-on-chain"))
		const unstamped = Fr.random()
		await expect(tab(store, w).pay(unstamped)).rejects.toThrow(TOKEN_REFUSALS.payment)
		await tab(store, w).pay(unstamped, merchant)
		expect(w.chain.included).toHaveLength(1)
		expect(await store.get(paymentKey(token, paid))).toBeUndefined()
	})
})

describe("openedCommitment", () => {
	it("takes the one request effect the token emitted", async () => {
		const c = Fr.random()
		const effect = (contractAddress: AztecAddress, data: Fr[]) => ({ contractAddress, data })
		const other = await AztecAddress.random()
		const effects = [
			effect(other, [REQUEST_OPENED_EFFECT, Fr.random()]),
			effect(token, [Fr.random()]),
			effect(token, [REQUEST_OPENED_EFFECT, c]),
		]
		expect(openedCommitment(effects, token).equals(c)).toBe(true)
		expect(() => openedCommitment(effects.slice(0, 2), token)).toThrow(/opened 0/)
		expect(() => openedCommitment([...effects, effects[2]!], token)).toThrow(/opened 2/)
	})
})
