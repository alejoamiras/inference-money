import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WagmiProvider } from "wagmi"
import { App } from "./App"
import { createBrowserEnv } from "./bridge/browser-env"
import { BridgeProvider, createBridge } from "./bridge/context"
import { wagmiConfig } from "./wallet/l1"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html lost its #root")

const bridge = createBridge(createBrowserEnv())

createRoot(root).render(
	<StrictMode>
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={new QueryClient()}>
				<BridgeProvider bridge={bridge}>
					<App />
				</BridgeProvider>
			</QueryClientProvider>
		</WagmiProvider>
	</StrictMode>,
)
