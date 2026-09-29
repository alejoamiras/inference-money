import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import {
	type ClaimTicket,
	claim,
	confirmDeposit,
	type DepositKind,
	type ExitTicket,
	ensurePermit2Allowance,
	type FeeChoice,
	finishWithdrawal,
	type L1Ctx,
	l2UsdcBalance,
	PERMIT2_DEPOSIT_ROUTER_ABI,
	prepareDeposit,
	submitDeposit,
	waitClaimable,
} from "@inference-money/bridge-core"
import { l1Signer } from "@inference-money/deployer"
import { L1_CHAIN_ID } from "@inference-money/local-network"
import { type Address, erc20Abi, getAbiItem, maxUint256, parseAbi } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { harness, newAccount } from "./harness"

export const USDC = 1_000_000n
const MOCK_USDC_ABI = parseAbi(["function mint(address to, uint256 amount)"])

/** A fresh anvil key with gas money and `usdc` MockUsdc, Permit2 already approved: a returning bridge user. */
export async function l1Actor(usdc = 1_000n * USDC): Promise<L1Ctx> {
	const { manifest: m, l1 } = harness()
	const signer = l1Signer(l1.rpcUrl, L1_CHAIN_ID, privateKeyToAccount(generatePrivateKey()))
	const account = signer.account.address
	await l1.test.setBalance({ address: account, value: 10n ** 20n })
	const write = async (args: Parameters<typeof signer.walletClient.writeContract>[0]) => {
		const hash = await signer.walletClient.writeContract(args)
		const r = await l1.publicClient.waitForTransactionReceipt({ hash })
		if (r.status !== "success") throw new Error(`actor setup tx ${hash} reverted`)
		return r
	}
	await write({
		address: m.l1.usdc,
		abi: MOCK_USDC_ABI,
		functionName: "mint",
		args: [account, usdc],
		account: signer.account,
		chain: signer.chain,
	})
	await ensurePermit2Allowance({
		allowance: () =>
			l1.publicClient.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "allowance", args: [account, m.l1.permit2] }),
		approveMax: () =>
			signer.walletClient.writeContract({
				address: m.l1.usdc,
				abi: erc20Abi,
				functionName: "approve",
				args: [m.l1.permit2, maxUint256],
				account: signer.account,
				chain: signer.chain,
			}),
		waitReceipt: (hash) => l1.publicClient.waitForTransactionReceipt({ hash }),
		needed: usdc,
	})
	return { publicClient: l1.publicClient, walletClient: signer.walletClient, account }
}

export const l2Actor = (): Promise<AztecAddress> => newAccount(harness().wallet, harness().manifest)

export async function usdcOf(who: Address): Promise<bigint> {
	const { manifest: m, l1 } = harness()
	return l1.publicClient.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })
}

export async function l2Balances(who: AztecAddress): Promise<{ public: bigint; private: bigint }> {
	const { manifest: m, wallet } = harness()
	const [pub, priv] = await Promise.all([l2UsdcBalance(wallet, m, who, "public"), l2UsdcBalance(wallet, m, who, "private")])
	return { public: pub, private: priv }
}

/** The permit deadline counts from L1 time, not the test machine's clock. */
export async function l1Now(): Promise<() => bigint> {
	const ts = (await harness().l1.publicClient.getBlock()).timestamp
	return () => ts
}

export async function deposit(l1: L1Ctx, kind: DepositKind, recipient: AztecAddress, amount: bigint): Promise<ClaimTicket> {
	const { manifest: m, node } = harness()
	const d = await prepareDeposit({ amount, recipient, kind }, m, await l1Now())
	await submitDeposit(d, l1, m, node)
	return confirmDeposit(d, l1, m)
}

export function claimable(t: ClaimTicket, from: AztecAddress): Promise<void> {
	const { manifest: m, node, wallet } = harness()
	return waitClaimable(t, node, wallet, m, from, undefined, { pollMs: 1_000, attempts: 600 })
}

/** Test accounts hold no Fee Juice, so public ops choose the sponsor explicitly; private ones rely on the default. */
export const payFor = (kind: DepositKind): FeeChoice | undefined => (kind === "public" ? "sponsored" : undefined)

export const claimFor = (t: ClaimTicket, from = t.draft.intent.recipient) =>
	claim(t, harness().node, harness().wallet, harness().manifest, { from, fee: payFor(t.draft.intent.kind) })

/** Deposits and claims, so `recipient` holds `amount` more in the given balance. */
export async function funded(l1: L1Ctx, kind: DepositKind, recipient: AztecAddress, amount: bigint): Promise<void> {
	const t = await deposit(l1, kind, recipient, amount)
	await claimable(t, recipient)
	const result = await claimFor(t)
	if (result !== "claimed") throw new Error(`funding claim returned ${result}`)
}

export function withdraw(t: ExitTicket, l1: L1Ctx) {
	const { manifest: m, node, outbox } = harness()
	return finishWithdrawal(t, node, outbox, l1, m, undefined, { pollMs: 2_000, timeoutMs: 15 * 60_000 })
}

/** Every router `Deposit` event `depositor` ever emitted. */
export async function depositsBy(depositor: Address): Promise<number> {
	const { manifest: m, l1 } = harness()
	const logs = await l1.publicClient.getLogs({
		address: m.l1.router,
		event: getAbiItem({ abi: PERMIT2_DEPOSIT_ROUTER_ABI, name: "Deposit" }),
		args: { depositor },
		fromBlock: BigInt(m.l1.deployBlock),
		strict: true,
	})
	return logs.length
}

/** The txs the actor wallet submitted while `fn` ran. */
export async function sentDuring(fn: () => Promise<unknown>) {
	const { sent } = harness()
	const from = sent.length
	await fn()
	return sent.slice(from)
}
