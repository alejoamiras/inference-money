import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import type { AztecNode } from "@aztec/aztec.js/node"
import type { Wallet } from "@aztec/aztec.js/wallet"
import type { ClaimTicket, DepositDraft, ExitTicket, L1Ctx } from "@inference-money/bridge-core"
import { type Address, getAddress, type Hex, maxUint256, type PublicClient, pad, type WalletClient } from "viem"
import { MANIFEST } from "@/config/network"
import { type BridgeEnv, type BridgeOps, bridgeOps, type TabLocks } from "../env"
import { createSwitchGate } from "../gate"
import { createInFlight } from "../pending"

export const L1_ACCOUNT: Address = getAddress("0x00000000000000000000000000000000000a11ce")
export const L1_TX: Hex = pad("0x7e", { size: 32 })

interface WriteRequest {
	functionName: string
	args: readonly unknown[]
}

/** A connected L1 wallet over an in-memory chain: every signature and send is recorded, never broadcast. */
export function fakeL1() {
	const s = {
		balance: 100_000_000n,
		allowance: maxUint256,
		now: 1_700_000_000n,
		readError: undefined as Error | undefined,
		signs: [] as { message: unknown }[],
		sends: [] as WriteRequest[],
		onSign: undefined as (() => void) | undefined,
		/** The next deposit send is recorded and never answered, as a wallet that broadcast and lost the reply. */
		hangNextSend: false,
	}
	const receipt = async () => ({ status: "success", logs: [] })
	const publicClient = {
		getChainId: async () => MANIFEST.l1.chainId,
		getBlock: async () => ({ number: 100n, hash: pad("0xb10c", { size: 32 }), timestamp: s.now }),
		readContract: async ({ functionName }: { functionName: string }) => {
			if (s.readError) throw s.readError
			return functionName === "balanceOf" ? s.balance : s.allowance
		},
		waitForTransactionReceipt: receipt,
		getTransactionReceipt: receipt,
	} as unknown as PublicClient
	const walletClient = {
		getChainId: async () => MANIFEST.l1.chainId,
		getAddresses: async () => [L1_ACCOUNT],
		signTypedData: async (req: { message: unknown }) => {
			s.signs.push(req)
			s.onSign?.()
			return pad("0x5195", { size: 65 })
		},
		writeContract: async (req: WriteRequest) => {
			s.sends.push(req)
			if (req.functionName === "approve") s.allowance = maxUint256
			if (req.functionName === "deposit" && s.hangNextSend) {
				s.hangNextSend = false
				return new Promise<never>(() => {})
			}
			return L1_TX
		},
	} as unknown as WalletClient
	const ctx: L1Ctx = { publicClient, walletClient, account: L1_ACCOUNT }
	return { s, ctx }
}

/** The Aztec node: only the bridge's pause flag and the proving window are ever read directly. */
export function fakeNode() {
	const s = { paused: false }
	const node = {
		getPublicStorageAt: async () => (s.paused ? new Fr(1) : Fr.ZERO),
		getTxReceipt: async () => ({ blockNumber: 12 }),
		getBlockNumber: async () => 10,
	} as unknown as AztecNode
	return { s, node }
}

/** Web Locks' `ifAvailable` over one shared set: two flows on one instance behave like two tabs of one origin. */
export function fakeLocks(): TabLocks & { held: Set<string> } {
	const held = new Set<string>()
	return {
		held,
		async ifAvailable(name, fn) {
			if (held.has(name)) return fn(false)
			held.add(name)
			try {
				return await fn(true)
			} finally {
				held.delete(name)
			}
		},
	}
}

export const ticketFor = (d: DepositDraft): ClaimTicket => ({ draft: d, messageHash: pad("0x3e55", { size: 32 }), leafIndex: 7n })

export const exitTicket = (o: Partial<ExitTicket> = {}): ExitTicket =>
	({
		l2TxHash: { toString: () => pad("0xe1", { size: 32 }) },
		recipient: L1_ACCOUNT,
		amount: 5_000_000n,
		messageHash: pad("0x3a", { size: 32 }),
		messageIndexInTx: 0,
		...o,
	}) as ExitTicket

/**
 * Real bridge-core for everything L1 (the draft, the signature, the pause re-reads, the send), fakes for the steps
 * that need an Aztec network. Each fake resolves at once unless a test replaces it.
 */
export async function fakeEnv(ops: Partial<BridgeOps> = {}, o: { account?: AztecAddress } = {}) {
	const l1 = fakeL1()
	const node = fakeNode()
	const unload = new EventTarget()
	const wallet = {} as Wallet
	const account = o.account ?? (await AztecAddress.random())
	const env: BridgeEnv = {
		manifest: MANIFEST,
		node: node.node,
		ops: {
			...bridgeOps,
			predictedWorstMinFees: async () => ({}) as never,
			confirmDeposit: async (d) => ticketFor(d),
			waitClaimable: async () => {},
			claim: async () => "claimed",
			waitClaimFinalized: async () => "finalized",
			l2Balance: async () => 50_000_000n,
			exitToL1: async () => exitTicket(),
			exitTicketFromTx: async () => exitTicket(),
			waitWithdrawable: async () => ({}) as never,
			isExitWithdrawn: async () => false,
			withdrawOnL1: async () => L1_TX,
			...ops,
		},
		l1: async () => l1.ctx,
		l2: () => ({ wallet, account }),
		session: { current: () => wallet, reregisterContracts: async () => true },
		locks: fakeLocks(),
		inFlight: createInFlight(unload),
		gate: createSwitchGate(),
	}
	return { env, l1: l1.s, node: node.s, unload, account }
}

/**
 * The deposit's draft and send without bb.js, whose wasm cannot run under jsdom (cross-realm typed arrays). Node-env
 * tests keep the real ones.
 */
export const offlineDepositOps: Partial<BridgeOps> = {
	prepareDeposit: async (intent) => ({ intent }) as DepositDraft,
	submitDeposit: async (d, _l1, _m, _l2, on) => {
		on?.("signing")
		on?.("depositing")
		d.submission = { account: L1_ACCOUNT, chainId: MANIFEST.l1.chainId, fromBlock: 1n, fromBlockHash: pad("0x1", { size: 32 }) }
		d.l1TxHash = L1_TX
		return L1_TX
	},
}

/** Every step a flow's store passes through, in order. */
export function stepsOf(store: { subscribe(l: () => void): () => void; get(): { step: string } }): string[] {
	const steps: string[] = []
	store.subscribe(() => {
		const { step } = store.get()
		if (steps.at(-1) !== step) steps.push(step)
	})
	return steps
}

export function deferred<T>() {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}
