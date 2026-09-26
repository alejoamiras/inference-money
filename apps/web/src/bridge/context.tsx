import { createContext, type ReactNode, useContext } from "react"
import { DepositFlow } from "./deposit-flow"
import type { BridgeEnv } from "./env"
import { WithdrawFlow } from "./withdraw-flow"

/** The page's two flows over one environment; they outlive any screen, so switching direction loses nothing. */
export interface Bridge {
	readonly env: BridgeEnv
	readonly deposit: DepositFlow
	readonly withdraw: WithdrawFlow
}

export const createBridge = (env: BridgeEnv): Bridge => ({ env, deposit: new DepositFlow(env), withdraw: new WithdrawFlow(env) })

const BridgeContext = createContext<Bridge | null>(null)

export function BridgeProvider({ bridge, children }: { bridge: Bridge; children: ReactNode }) {
	return <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>
}

export function useBridge(): Bridge {
	const bridge = useContext(BridgeContext)
	if (!bridge) throw new Error("useBridge needs a BridgeProvider above it.")
	return bridge
}
