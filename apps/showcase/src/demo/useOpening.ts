import { useEffect, useState } from "react"
import type { DemoWallet } from "./wallet"

export type Opening = { status: "opening" } | { status: "ready"; demo: DemoWallet } | { status: "failed"; message: string }

/** The page's wallet as it opens: the caller opens it once, this only follows the promise. */
export function useOpening(demo: Promise<DemoWallet>): Opening {
	const [opening, setOpening] = useState<Opening>({ status: "opening" })
	useEffect(() => {
		let live = true
		demo.then(
			(d) => live && setOpening({ status: "ready", demo: d }),
			(e: unknown) => live && setOpening({ status: "failed", message: e instanceof Error ? e.message : String(e) }),
		)
		return () => {
			live = false
		}
	}, [demo])
	return opening
}
