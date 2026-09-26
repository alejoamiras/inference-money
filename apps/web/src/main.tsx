import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WagmiProvider } from "wagmi"
import { App } from "./App"
import { wagmiConfig } from "./wallet/l1"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html lost its #root")

createRoot(root).render(
	<StrictMode>
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={new QueryClient()}>
				<App />
			</QueryClientProvider>
		</WagmiProvider>
	</StrictMode>,
)
