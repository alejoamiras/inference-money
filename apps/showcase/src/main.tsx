import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html lost its #root")

// The wallet and the Aztec SDK load behind the tour, which needs neither: the page plays at once and opens them meanwhile.
const demo = import("./demo/start").then((m) => m.startDemo())

createRoot(root).render(
	<StrictMode>
		<App demo={demo} />
	</StrictMode>,
)
