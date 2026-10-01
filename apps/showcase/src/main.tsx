import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { startDemo } from "./demo/start"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html lost its #root")

const demo = startDemo()

createRoot(root).render(
	<StrictMode>
		<App demo={demo} />
	</StrictMode>,
)
