import { NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import type { ExecutionPayload } from "@aztec-labs/stdlib/tx"
import { MANIFEST } from "./fixtures"

/** What an aztec.js interaction hands the wallet; `feePayer` is set only by a payment method that names one. */
export interface SentTx {
	calls: string[]
	feePayer?: string
	authWitnesses: number
	/** The interaction's `wait` option: what the wallet was told to wait for before answering. */
	wait?: unknown
}

const record = (p: ExecutionPayload, wait?: unknown): SentTx => ({
	calls: p.calls.map((c) => c.name),
	feePayer: p.feePayer?.toString(),
	authWitnesses: p.authWitnesses.length,
	...(wait === undefined ? {} : { wait }),
})

// The fields `ContractFunctionInteraction.simulate` decodes from a successful simulation.
const SIMULATED = {
	getPrivateReturnValuesOfAppCall: () => undefined,
	getPublicReturnValues: () => [],
	offchainEffects: [],
	publicInputs: { constants: { anchorBlockHeader: { globalVariables: { timestamp: 0n } } } },
}

/** The four wallet methods the bridge's interactions reach; each call is recorded, and a hook can throw to script failures. */
export function fakeWallet(hooks: { send?: (tx: SentTx) => void; simulate?: (tx: SentTx) => void } = {}) {
	const sent: SentTx[] = []
	const simulated: SentTx[] = []
	const authWits: { from: string; caller: string }[] = []
	const txHash = TxHash.random()
	const wallet = {
		getChainInfo: async () => ({ chainId: new Fr(MANIFEST.l1.chainId), version: new Fr(MANIFEST.l2.rollupVersion) }),
		createAuthWit: async (from: { toString(): string }, intent: { caller: { toString(): string } }) => {
			authWits.push({ from: from.toString(), caller: intent.caller.toString() })
			return { requestHash: Fr.random(), witness: [] }
		},
		sendTx: async (p: ExecutionPayload, opts?: { wait?: unknown }) => {
			const tx = record(p, opts?.wait)
			sent.push(tx)
			hooks.send?.(tx)
			return opts?.wait === NO_WAIT ? { txHash } : { receipt: { txHash } }
		},
		simulateTx: async (p: ExecutionPayload) => {
			const tx = record(p)
			simulated.push(tx)
			hooks.simulate?.(tx)
			return SIMULATED
		},
	} as unknown as Wallet
	return { wallet, sent, simulated, authWits, txHash }
}
