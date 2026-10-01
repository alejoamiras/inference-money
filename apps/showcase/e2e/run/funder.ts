/**
 * What a spec needs set up on L2 before its page does the part under test, done in Bun from the sidecar's own wallet
 * (which holds every actor it created): Fee Juice for actors whose public txs their wallet pays, a public USDC balance,
 * and a public exit to finish from the page.
 */
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { FeeJuiceContract } from "@aztec-labs/aztec.js/protocol"
import type { EmbeddedWallet } from "@aztec-labs/wallets/embedded"
import {
	type BridgeManifest,
	claim,
	confirmDeposit,
	ensurePermit2Allowance,
	exitToL1,
	type L1Ctx,
	prepareDeposit,
	sponsoredPayment,
	submitDeposit,
	waitClaimable,
} from "@inference-money/bridge-core"
import { bridgeFeeJuice, l1Signer } from "@inference-money/deployer"
import { L1_CHAIN_ID } from "@inference-money/local-network"
import { type Address, erc20Abi, type Hex, maxUint256, parseAbi } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const MOCK_USDC_ABI = parseAbi(["function mint(address to, uint256 amount)"])
/** Enough MockUsdc for every funding a run makes. */
const FUNDER_USDC = 10n ** 12n
const CLAIMABLE = { pollMs: 1_000, attempts: 600 }

export interface Funder {
	/** Mints Fee Juice to each account, claimed publicly, so its wallet can pay its own public txs. */
	feeJuice(to: AztecAddress): Promise<void>
	/** Deposits `amount` publicly to `to` and claims it from `to`, sponsored. */
	fundPublic(to: AztecAddress, amount: bigint): Promise<void>
	/** A public exit of `amount` from `from` to `recipient`, sponsored; the L2 tx hash to finish it from. */
	exitPublic(from: AztecAddress, amount: bigint, recipient: Address): Promise<string>
}

async function fundedL1(anvilUrl: string, m: BridgeManifest): Promise<{ ctx: L1Ctx; key: Hex }> {
	const key = generatePrivateKey()
	const signer = l1Signer(anvilUrl, L1_CHAIN_ID, privateKeyToAccount(key))
	const account = signer.account.address
	await signer.publicClient.request({ method: "anvil_setBalance" as never, params: [account, "0x56bc75e2d63100000"] as never })
	const send = async (hash: Hex) => {
		const r = await signer.publicClient.waitForTransactionReceipt({ hash })
		if (r.status !== "success") throw new Error(`funder setup tx ${hash} reverted`)
		return r
	}
	const write = { account: signer.account, chain: signer.chain } as const
	await send(
		await signer.walletClient.writeContract({
			...write,
			address: m.l1.usdc,
			abi: MOCK_USDC_ABI,
			functionName: "mint",
			args: [account, FUNDER_USDC],
		}),
	)
	await ensurePermit2Allowance({
		allowance: () =>
			signer.publicClient.readContract({
				address: m.l1.usdc,
				abi: erc20Abi,
				functionName: "allowance",
				args: [account, m.l1.permit2],
			}),
		approveMax: () =>
			signer.walletClient.writeContract({
				...write,
				address: m.l1.usdc,
				abi: erc20Abi,
				functionName: "approve",
				args: [m.l1.permit2, maxUint256],
			}),
		waitReceipt: send,
		needed: FUNDER_USDC,
	})
	return { ctx: { publicClient: signer.publicClient, walletClient: signer.walletClient, account }, key }
}

export async function createFunder(o: { wallet: EmbeddedWallet; node: AztecNode; m: BridgeManifest; anvilUrl: string }): Promise<Funder> {
	const { wallet, node, m } = o
	const l1 = await fundedL1(o.anvilUrl, m)
	const sponsored = { paymentMethod: sponsoredPayment(m) }
	return {
		async feeJuice(to) {
			const minted = await bridgeFeeJuice({
				node,
				l1RpcUrl: o.anvilUrl,
				l1PrivateKey: l1.key,
				to,
				l1ChainId: L1_CHAIN_ID,
				log: () => {},
			})
			await FeeJuiceContract.at(wallet)
				.methods.claim(to, minted.claimAmount, minted.claimSecret, new Fr(minted.messageLeafIndex))
				.send({ from: to, fee: sponsored })
		},
		async fundPublic(to, amount) {
			const tip = (await l1.ctx.publicClient.getBlock()).timestamp
			const d = await prepareDeposit({ amount, recipient: to, kind: "public" }, m, () => tip)
			await submitDeposit(d, l1.ctx, m, node)
			const t = await confirmDeposit(d, l1.ctx, m)
			await waitClaimable(t, node, wallet, m, to, undefined, CLAIMABLE)
			if ((await claim(t, node, wallet, m, { from: to, fee: "sponsored" })) !== "claimed")
				throw new Error("funding claim not claimed")
		},
		async exitPublic(from, amount, recipient) {
			const t = await exitToL1({ kind: "public", from, recipientL1: recipient, amount }, wallet, node, m, { fee: "sponsored" })
			return t.l2TxHash.toString()
		},
	}
}

export const aztecAddress = (v: unknown): AztecAddress => {
	if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`not an Aztec address: ${String(v)}`)
	return AztecAddress.fromStringUnsafe(v)
}
