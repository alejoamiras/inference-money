import { NO_FROM } from "@aztec/aztec.js/account"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fq, Fr } from "@aztec/aztec.js/fields"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import type { NetworkPins } from "./networks"

export interface SpikeResult {
	account: string
	txHash: string
	blockNumber: number | undefined
	minutes: string
}

/**
 * Deploys a throwaway Schnorr account with real client proofs, paid by the canonical SponsoredFPC.
 * The only key it creates is random, in memory, never logged or persisted, and controls nothing of value.
 */
export async function proofCompatSpike(pins: NetworkPins, log: (msg: string) => void): Promise<SpikeResult> {
	const t0 = Date.now()
	const wallet = await EmbeddedWallet.create(pins.nodeUrl, { ephemeral: true, pxe: { proverEnabled: true } })
	try {
		const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
		if (!fpc.address.equals(AztecAddress.fromStringUnsafe(pins.sponsoredFpc))) {
			throw new Error(`derived SponsoredFPC ${fpc.address} != pinned ${pins.sponsoredFpc}: artifact/class drift`)
		}
		await wallet.registerContract(fpc, SponsoredFPCContract.artifact)
		const manager = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), Fq.random())
		log(`account ${manager.address}: proving + sending deploy (real proofs, several minutes)`)
		const deploy = await manager.getDeployMethod()
		const { receipt } = await deploy.send({ from: NO_FROM, fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) } })
		return {
			account: manager.address.toString(),
			txHash: receipt.txHash.toString(),
			blockNumber: receipt.blockNumber,
			minutes: ((Date.now() - t0) / 60000).toFixed(1),
		}
	} finally {
		await wallet.stop()
	}
}
