import "@alejoamiras/presto-banners/register"
import "./ribbon.css"
import type { PrestoBanner } from "@alejoamiras/presto-banners"
import { useEffect, useRef } from "react"
import { TESTIDS } from "@/lib/testids"
import type { PrestoConsent, PrestoView } from "./consent"

function show(banner: PrestoBanner, view: PrestoView | undefined) {
	if (view === undefined) return
	if (view === "ask") banner.state = "connect"
	else if (view === "blocked") banner.state = "permission-blocked"
	else banner.status = view
}

/**
 * Built outside React, attributes before it connects: React would assign `variant` to the element's getter-only
 * property, and a connected element without `fonts="none"` links Google Fonts. Every view reaches it, a repeated one
 * included: that is what ends "Connecting…".
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
