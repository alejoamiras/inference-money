import { type BridgeManifest, ensurePermit2Allowance, type L1Ctx } from "@inference-money/bridge-core"
import { DEMO_L1_TARGET, ethereumKey, USERS, type User } from "@inference-money/demo"
import { type Address, createTestClient, erc20Abi, http, maxUint256, parseAbi } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { type L1Signer, l1Chain, l1Signer, writeEvm } from "./l1"

const MOCK_USDC_ABI = parseAbi(["function mint(address to, uint256 amount)"])

/** A_demo (alice's) or B_demo (bob's). Their keys are public: anyone may sign as them. */
export const demoSigner = (rpcUrl: string, m: BridgeManifest, user: User): L1Signer =>
	l1Signer(rpcUrl, m.l1.chainId, privateKeyToAccount(ethereumKey(m.l2.bridge.address, user)))

export const l1Ctx = (s: L1Signer): L1Ctx => ({ publicClient: s.publicClient, walletClient: s.walletClient, account: s.account.address })

export const usdcOf = (l1: Pick<L1Signer, "publicClient">, m: BridgeManifest, who: Address): Promise<bigint> =>
	l1.publicClient.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })

/** Lets Permit2 pull `signer`'s USDC: one unlimited approval, sent only while the allowance is below `needed`. */
export async function approvePermit2(signer: L1Signer, m: BridgeManifest, needed: bigint): Promise<void> {
	const owner = signer.account.address
	await ensurePermit2Allowance({
		allowance: () =>
			signer.publicClient.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "allowance", args: [owner, m.l1.permit2] }),
		approveMax: () =>
			signer.walletClient.writeContract({
				address: m.l1.usdc,
				abi: erc20Abi,
				functionName: "approve",
				args: [m.l1.permit2, maxUint256],
				account: signer.account,
				chain: signer.chain,
			}),
		waitReceipt: (hash) => signer.publicClient.waitForTransactionReceipt({ hash }),
		needed,
	})
}

/** Where top-ups come from: anvil itself on local, the keyed L1 account on testnet. ETH arrives before USDC. */
export interface Faucet {
	eth(to: Address, target: bigint, short: bigint): Promise<void>
	usdc(to: L1Signer, short: bigint): Promise<void>
}

/** Local only: anvil sets the balance, and MockUsdc mints to anyone, so the recipient mints its own. */
export function anvilFaucet(rpcUrl: string, m: BridgeManifest): Faucet {
	const test = createTestClient({ chain: l1Chain(rpcUrl, m.l1.chainId), mode: "anvil", transport: http(rpcUrl) })
	return {
		eth: (address, target) => test.setBalance({ address, value: target }),
		usdc: async (to, short) => {
			await writeEvm(to, "MockUsdc mint", m.l1.usdc, MOCK_USDC_ABI, "mint", [to.account.address, short])
		},
	}
}

/** Transfers from `funder`, which must hold enough of both. */
export function signerFaucet(funder: L1Signer, m: BridgeManifest): Faucet {
	return {
		eth: async (to, _target, short) => {
			const hash = await funder.walletClient.sendTransaction({ to, value: short, account: funder.account, chain: funder.chain })
			const receipt = await funder.publicClient.waitForTransactionReceipt({ hash })
			if (receipt.status !== "success") throw new Error(`ETH transfer to ${to} reverted (tx ${hash})`)
		},
		usdc: async (to, short) => {
			await writeEvm(funder, "USDC transfer", m.l1.usdc, erc20Abi, "transfer", [to.account.address, short])
		},
	}
}

/** Tops A_demo and B_demo up to {@link DEMO_L1_TARGET} and approves Permit2 from each; holdings above it stay. */
export async function fundDemoL1(rpcUrl: string, m: BridgeManifest, faucet: Faucet, log: (m: string) => void): Promise<void> {
	for (const user of USERS) {
		const signer = demoSigner(rpcUrl, m, user)
		const address = signer.account.address
		const target = DEMO_L1_TARGET[user]
		const eth = target.eth - (await signer.publicClient.getBalance({ address }))
		if (eth > 0n) await faucet.eth(address, target.eth, eth)
		const usdc = target.usdc - (await usdcOf(signer, m, address))
		if (usdc > 0n) await faucet.usdc(signer, usdc)
		await approvePermit2(signer, m, target.usdc)
		log(`${user}'s Ethereum account ${address}: topped up to ${target.eth} wei and ${target.usdc} USDC units`)
	}
}
