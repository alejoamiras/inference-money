import "@alejoamiras/presto-banners/register"
import "./ribbon.css"
import type { PrestoBanner } from "@alejoamiras/presto-banners"
import { useEffect, useRef } from "react"
import { TESTIDS } from "@/lib/testids"
import type { PrestoConsent, PrestoView } from "./consent"

/** The ask and the block are the page's own states; a status check the element maps itself. */
function show(banner: PrestoBanner, view: PrestoView | undefined) {
	if (view === undefined) return
	if (view === "ask") banner.state = "connect"
	else if (view === "blocked") banner.state = "permission-blocked"
	else banner.status = view
}

/**
 * Presto's own ribbon, above "Inside the wallets". Built outside React with its attributes set before it connects:
 * React would assign `variant` to the element's read-only property, and the element links Google Fonts on connect
 * unless `fonts="none"` is already there. Every view reaches it, a repeated one included, which ends "Connecting…".
 */
export function PrestoRibbon({ consent }: { consent: PrestoConsent }) {
	const slot = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const banner = document.createElement("presto-banner") as PrestoBanner
		banner.setAttribute("variant", "ribbon")
		banner.setAttribute("theme", "light")
		banner.setAttribute("fonts", "none")
		banner.dataset.testid = TESTIDS.prestoRibbon
		const connect = () => void consent.connect()
		banner.addEventListener("presto-banner:connect", connect)
		banner.addEventListener("presto-banner:retry", connect)
		slot.current?.append(banner)
		show(banner, consent.view.get())
		const unlisten = consent.view.listen((view) => show(banner, view))
		return () => {
			unlisten()
			banner.remove()
		}
	}, [consent])
	// A hidden ribbon takes no room, so the column's gap does not open around it.
	return <div ref={slot} className="overflow-hidden rounded-xl empty:hidden [&:has(>[hidden])]:hidden" />
}
