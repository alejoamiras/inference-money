/**
 * The SDK mounts the wallet's session iframe in a large floating panel over the app's controls. The suite never
 * clicks inside it, so the panel is parked small in a corner the moment it appears; the frame stays attached and
 * scriptable.
 */
import type { BrowserContext } from "@playwright/test"

export async function parkWalletPanel(context: BrowserContext, walletOrigins: string[]): Promise<void> {
	await context.addInitScript((origins: string[]) => {
		const park = (node: Node) => {
			if (!(node instanceof HTMLElement) || node.tagName !== "DIV") return
			const frame = node.querySelector("iframe")
			if (!frame || node.style.position !== "fixed") return
			let origin = ""
			try {
				origin = new URL(frame.src).origin
			} catch {
				return
			}
			if (!origins.includes(origin)) return
			Object.assign(node.style, { left: "0px", top: "0px", width: "160px", height: "100px", opacity: "0.4" })
		}
		// Init scripts run before the document has an element, so the Document node is what can be observed.
		new MutationObserver((records) => {
			for (const r of records) for (const n of r.addedNodes) park(n)
		}).observe(document, { childList: true, subtree: true })
	}, walletOrigins)
}
