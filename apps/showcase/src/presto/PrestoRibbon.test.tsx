import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { cell } from "@/lib/observable"
import { TESTIDS } from "@/lib/testids"
import type { PrestoConsent, PrestoView } from "./consent"
import { PrestoRibbon } from "./PrestoRibbon"

describe("PrestoRibbon", () => {
	it("shows each view the consent reports, a repeated one included, and connects from its button", () => {
		const view = cell<PrestoView | undefined>(undefined)
		const consent: PrestoConsent = { view, connect: vi.fn(async () => {}), stop: vi.fn() }
		render(<PrestoRibbon consent={consent} />)
		const banner = screen.getByTestId(TESTIDS.prestoRibbon)
		expect(banner).toHaveAttribute("fonts", "none")
		expect(document.getElementById("presto-banner-fonts")).toBeNull()

		const shown = (v: PrestoView) => {
			act(() => view.set(v))
			return banner.getAttribute("state")
		}
		expect(shown("blocked")).toBe("permission-blocked")
		expect(shown({ available: false, reason: "offline" })).toBe("offline")
		expect(shown({ available: true, needsDownload: true, protocol: "https" })).toBe("downloading")
		expect(shown("ask")).toBe("connect")

		const connect = () => banner.shadowRoot?.querySelector('[data-action="connect"]')
		act(() => (connect() as HTMLElement).click())
		expect(consent.connect).toHaveBeenCalledTimes(1)
		expect(connect()).toHaveAttribute("aria-busy", "true")
		shown("ask")
		expect(connect()).toHaveAttribute("aria-busy", "false")
	})
})
