import type { L1Ctx } from "@inference-money/bridge-core"
import { createConfig, injected, unstable_connector, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi"
import { getPublicClient, getWalletClient } from "wagmi/actions"
import { L1_CHAIN } from "@/config/network"

/**
 * One injected connector (`window.ethereum`), and every L1 read routed through it: a page-origin RPC fetch would need
 * a CSP hole and a third-party RPC the user never chose. Reads therefore need a connected wallet, and every read path
 * is gated on one.
 */
export const wagmiConfig = createConfig({
	chains: [L1_CHAIN],
	connectors: [injected()],
	multiInjectedProviderDiscovery: false,
	transports: { [L1_CHAIN.id]: unstable_connector(injected) },
})

declare module "wagmi" {
	interface Register {
		config: typeof wagmiConfig
	}
}

export interface L1State {
	readonly address: `0x${string}` | undefined
	readonly chainId: number | undefined
	readonly status: "connected" | "connecting" | "reconnecting" | "disconnected"
	/** Connected, but to another chain than the bridge's; every write refuses until it switches. */
	readonly wrongChain: boolean
	readonly hasProvider: boolean
	readonly error: Error | null
	connect(): void
	disconnect(): void
	switchChain(): void
}

export function useL1(): L1State {
	const connection = useConnection()
	const [connector] = useConnectors()
	const connect = useConnect()
	const disconnect = useDisconnect()
	const switchChain = useSwitchChain()
	return {
		address: connection.address,
		chainId: connection.chainId,
		status: connection.status,
		wrongChain: connection.status === "connected" && connection.chainId !== L1_CHAIN.id,
		hasProvider: typeof window !== "undefined" && "ethereum" in window,
		error: connect.error ?? switchChain.error ?? null,
		connect: () => connector && connect.mutate({ connector, chainId: L1_CHAIN.id }),
		disconnect: () => disconnect.mutate(),
		switchChain: () => switchChain.mutate({ chainId: L1_CHAIN.id }),
	}
}

/** The bridge-core L1 context for the connected account, taken at action time; throws off-chain or disconnected. */
export async function l1Context(): Promise<L1Ctx> {
	const walletClient = await getWalletClient(wagmiConfig, { chainId: L1_CHAIN.id })
	const publicClient = getPublicClient(wagmiConfig, { chainId: L1_CHAIN.id })
	return { publicClient, walletClient, account: walletClient.account.address } as L1Ctx
}
