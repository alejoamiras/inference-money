/**
 * The suite's own view of the chains, independent of the app: the run's manifest, anvil reads and time, and the
 * sidecar's L2 setup calls. Everything here is Node-side and never goes through the page.
 */
import { readFileSync } from "node:fs"
import { type Address, createPublicClient, createWalletClient, decodeFunctionData, type Hex, http, parseAbi, parseAbiItem } from "viem"
import { privateKeyToAccount } from "viem/accounts"

/** The manifest fields the suite reads; the app embeds the same file. */
export interface RunManifest {
	l1: { usdc: Address; router: Address; portal: Address; outbox: Address; deployBlock: number }
	l2: { nodeUrl: string; sponsoredFpc?: string; bridge: { address: string }; token: { address: string } }
}

export const readRunManifest = (path: string): RunManifest => JSON.parse(readFileSync(path, "utf8")) as RunManifest

/** Restated from the contract, not imported from bridge-core: decoding fails if the two ever diverge. */
export const ROUTER_ABI = parseAbi([
	"function deposit(uint256 amount, bytes32 aztecRecipient, bytes32 secretHash, bool isPrivate, uint256 nonce, uint256 deadline, bytes signature)",
])
const DEPOSIT_EVENT = parseAbiItem(
	"event Deposit(address indexed depositor, bytes32 indexed aztecRecipient, bytes32 key, uint256 index, uint256 amount, bytes32 secretHash, bool isPrivate)",
)
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)", "function mint(address to, uint256 amount)"])

const reader = (anvilUrl: string) => createPublicClient({ transport: http(anvilUrl) })

export function usdcOf(anvilUrl: string, m: RunManifest, who: Address): Promise<bigint> {
	return reader(anvilUrl).readContract({ address: m.l1.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [who] })
}

export async function mintUsdc(anvilUrl: string, m: RunManifest, key: Hex, amount: bigint): Promise<void> {
	const account = privateKeyToAccount(key)
	const wallet = createWalletClient({ account, transport: http(anvilUrl) })
	const chainId = await reader(anvilUrl).getChainId()
	const hash = await wallet.writeContract({
		address: m.l1.usdc,
		abi: ERC20_ABI,
		functionName: "mint",
		args: [account.address, amount],
		chain: {
			id: chainId,
			name: "anvil",
			nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
			rpcUrls: { default: { http: [anvilUrl] } },
		},
	})
	await reader(anvilUrl).waitForTransactionReceipt({ hash })
}

/** Every router deposit `depositor` made, decoded from the calldata that actually mined. */
export async function depositsBy(anvilUrl: string, m: RunManifest, depositor: Address) {
	const client = reader(anvilUrl)
	const logs = await client.getLogs({
		address: m.l1.router,
		event: DEPOSIT_EVENT,
		args: { depositor },
		fromBlock: BigInt(m.l1.deployBlock),
	})
	return Promise.all(
		logs.map(async (log) => {
			const tx = await client.getTransaction({ hash: log.transactionHash as Hex })
			const [amount, aztecRecipient, secretHash, isPrivate, nonce, deadline] = decodeFunctionData({
				abi: ROUTER_ABI,
				data: tx.input,
			}).args
			return { txHash: log.transactionHash as Hex, amount, aztecRecipient, secretHash, isPrivate, nonce, deadline }
		}),
	)
}

/**
 * Mines L1 blocks until `finalized` (two behind the tip here) is timestamped past `deadline`. Timestamps are set from
 * the head, not with `evm_increaseTime`: the Aztec node warps L1 blocks ahead of anvil's own clock, which that offset
 * never catches. The node's next warp may land first, so a short-landing attempt is retried.
 */
export async function mineL1Past(anvilUrl: string, deadline: bigint): Promise<void> {
	const client = reader(anvilUrl)
	for (let attempt = 0; attempt < 3; attempt++) {
		const head = await client.getBlock({ blockTag: "latest" })
		const next = (head.timestamp > deadline ? head.timestamp : deadline) + 1n
		await client.request({ method: "evm_setNextBlockTimestamp" as never, params: [Number(next)] as never })
		await client.request({ method: "anvil_mine" as never, params: ["0x5"] as never })
		const finalized = await client.getBlock({ blockTag: "finalized" })
		if (finalized.timestamp > deadline) return
	}
	throw new Error(`L1's finalized block is still not past ${deadline}`)
}

/** The Aztec node's own receipt for `hash`, read here rather than through any wallet or the app. */
export async function l2Receipt(nodeUrl: string, hash: string): Promise<{ status: string; executionResult?: string }> {
	const res = await fetch(nodeUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getTxReceipt", params: [hash] }),
	})
	const body = (await res.json()) as { result?: { status: string; executionResult?: string }; error?: unknown }
	if (!body.result) throw new Error(`node_getTxReceipt ${hash}: ${JSON.stringify(body.error)}`)
	return body.result
}

async function sidecar<T>(url: string, path: string, body: unknown): Promise<T> {
	const res = await fetch(`${url}${path}`, { method: "POST", body: JSON.stringify(body) })
	if (!res.ok) throw new Error(`sidecar ${path} failed: ${res.status} ${await res.text()}`)
	return (await res.json()) as T
}

/** A public USDC balance of `amount` for `address`, deposited and claimed by the sidecar. */
export const fundPublic = (sidecarUrl: string, address: string, amount: bigint) =>
	sidecar<{ ok: true }>(sidecarUrl, "/fund", { address, amount: amount.toString() })

/** An actor's USDC on Aztec, read by the sidecar's own wallet: independent of the app and of the page's wallet. */
export const l2BalanceOf = async (sidecarUrl: string, address: string, kind: "public" | "private") =>
	BigInt((await sidecar<{ balance: string }>(sidecarUrl, "/balance", { address, kind })).balance)

/** A public exit from `from` to `recipient`, made by the sidecar; its L2 tx hash. */
export const exitPublic = async (sidecarUrl: string, from: string, amount: bigint, recipient: Address) =>
	(await sidecar<{ l2TxHash: string }>(sidecarUrl, "/exit", { from, amount: amount.toString(), recipient })).l2TxHash
