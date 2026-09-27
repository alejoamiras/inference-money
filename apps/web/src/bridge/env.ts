import type { AztecAddress } from "@aztec/aztec.js/addresses"
import type { AztecNode } from "@aztec/aztec.js/node"
import type { Wallet } from "@aztec/aztec.js/wallet"
import type {
	BridgeManifest,
	L1Ctx,
	RetrySession,
	WaitClaimableOptions,
	WaitClaimFinalizedOptions,
	WaitWithdrawableOptions,
} from "@inference-money/bridge-core"
import * as core from "@inference-money/bridge-core"
import { l2Balance } from "./balances"
import type { SwitchGate } from "./gate"
import type { InFlight } from "./pending"

/** The connected Aztec wallet and the account the user selected in it. */
export interface L2Ctx {
	readonly wallet: Wallet
	readonly account: AztecAddress
}

/** The node, both wallets and the selected accounts against the embedded manifest, before anything is signed. */
async function assertNetwork(node: AztecNode, l1: L1Ctx, l2: L2Ctx, m: BridgeManifest): Promise<void> {
	await Promise.all([
		core.assertNetworkIdentity(node, l1.publicClient, m),
		core.assertSigningContext(l1, l2.wallet, m, { l1Account: l1.account, l2Account: l2.account }),
	])
}

/** The steps a bridge flow runs; tests replace the ones that need a live network. */
export const bridgeOps = {
	ensurePermit2Allowance: core.ensurePermit2Allowance,
	prepareDeposit: core.prepareDeposit,
	submitDeposit: core.submitDeposit,
	confirmDeposit: core.confirmDeposit,
	reconcileDeposit: core.reconcileDeposit,
	waitClaimable: core.waitClaimable,
	claim: core.claim,
	waitClaimFinalized: core.waitClaimFinalized,
	isBridgePaused: core.isBridgePaused,
	predictedWorstMinFees: core.predictedWorstMinFees,
	exitToL1: core.exitToL1,
	exitTicketFromTx: core.exitTicketFromTx,
	waitWithdrawable: core.waitWithdrawable,
	isExitWithdrawn: core.isExitWithdrawn,
	withdrawOnL1: core.withdrawOnL1,
	retryOnUnregistered: core.retryOnUnregistered,
	assertNetwork,
	l2Balance,
}

export type BridgeOps = typeof bridgeOps

export interface TabLocks {
	/** Runs `fn` holding `name` only if no other tab of this origin holds it; `fn` learns which. */
	ifAvailable<T>(name: string, fn: (held: boolean) => Promise<T>): Promise<T>
}

/** Web Locks; refuses outright where they are missing, since nothing else keeps two tabs from both submitting. */
export function webLocks(): TabLocks {
	return {
		ifAvailable(name, fn) {
			const locks = globalThis.navigator?.locks
			if (!locks) throw new Error("This browser cannot coordinate its tabs. Update it to finish a withdrawal.")
			return locks.request(name, { ifAvailable: true }, (lock) => fn(lock !== null))
		},
	}
}

/** Everything a flow touches, read at action time so a flow always acts on the wallets connected right now. */
export interface BridgeEnv {
	readonly manifest: BridgeManifest
	readonly node: AztecNode
	readonly ops: BridgeOps
	/** Throws when no Ethereum wallet is connected on the bridge's chain. */
	l1(): Promise<L1Ctx>
	/** Throws when no Aztec wallet is connected with the bridge's contracts registered. */
	l2(): L2Ctx
	readonly session: RetrySession<Wallet>
	readonly locks: TabLocks
	readonly inFlight: InFlight
	readonly gate: SwitchGate
	readonly timing?: {
		readonly claim?: WaitClaimableOptions
		readonly finalized?: WaitClaimFinalizedOptions
		readonly proof?: WaitWithdrawableOptions
	}
}
