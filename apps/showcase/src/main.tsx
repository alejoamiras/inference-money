import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html lost its #root")

// The wallet and the Aztec SDK start loading with the page: "Try it yourself" waits for them, the recording needs neither.
const demo = import("./demo/start").then((m) => m.startDemo())

createRoot(root).render(
	<StrictMode>
		<App demo={demo} />
	</StrictMode>,
)
