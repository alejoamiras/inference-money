import { NO_FROM } from "@aztec/aztec.js/account"
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee"
import { Fq, Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { bridgeFeeJuice } from "./fee-juice"
import type { NetworkPins } from "./networks"
import type { TestnetSecrets } from "./secrets"

export interface SpikeResult {
	account: string
	txHash: string
	blockNumber: number | undefined
	transactionFee: bigint | undefined
	minutes: string
}

/**
 * Deploys a throwaway Schnorr account with real client proofs, paying with Fee Juice bridged from L1 and
 * claimed in the same tx. The Aztec key is random, in memory, never logged or persisted, and controls
 * nothing of value; the L1 key only mints the testnet fee asset and bridges it.
 */
export async function proofCompatSpike(
	pins: NetworkPins,
	secrets: Pick<TestnetSecrets, "l1PrivateKey">,
	l1RpcUrl: string,
	log: (msg: string) => void,
): Promise<SpikeResult> {
	const t0 = Date.now()
	const node = createAztecNodeClient(pins.nodeUrl)
	const wallet = await EmbeddedWallet.create(node, { ephemeral: true, pxe: { proverEnabled: true } })
	try {
		const manager = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), Fq.random())
		const claim = await bridgeFeeJuice({
			node,
			l1RpcUrl,
			l1PrivateKey: secrets.l1PrivateKey,
			l1ChainId: pins.l1ChainId,
			to: manager.address,
			log,
		})
		log(`account ${manager.address}: proving + sending deploy (real proofs, several minutes)`)
		const deploy = await manager.getDeployMethod()
		const { receipt } = await deploy.send({
			from: NO_FROM,
			fee: { paymentMethod: new FeeJuicePaymentMethodWithClaim(manager.address, claim) },
		})
		return {
			account: manager.address.toString(),
			txHash: receipt.txHash.toString(),
			blockNumber: receipt.blockNumber,
			transactionFee: receipt.transactionFee,
			minutes: ((Date.now() - t0) / 60000).toFixed(1),
		}
	} finally {
		await wallet.stop()
	}
}
