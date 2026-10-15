import { act, render } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { openOnce } from "./demo/useOpening"
import type { DemoWallet } from "./demo/wallet"

// The views load the Aztec SDK; only whether the page opens its wallet is under test here.
vi.mock("@/live/LiveRoot", () => ({ LiveRoot: () => <p>live</p> }))
vi.mock("@/proving/ProvingPage", () => ({ ProvingPage: () => <p>proving</p> }))
vi.mock("@/tour/TourMode", () => ({ TourMode: () => <p>tour</p> }))

const goTo = (hash: string) =>
	act(async () => {
		window.location.hash = hash
		window.dispatchEvent(new HashChangeEvent("hashchange"))
	})

describe("App", () => {
	it("opens the wallet only for a view that needs it, and once per page across hash changes", async () => {
		let starts = 0
		let opened = (_: DemoWallet) => {}
		const opening = new Promise<DemoWallet>((resolve) => {
			opened = resolve
		})
		const openDemo = openOnce(() => {
			starts++
			return opening
		})
		window.location.hash = "#recorded"
		render(
			<StrictMode>
				<App openDemo={openDemo} />
			</StrictMode>,
		)
		await act(async () => {})
		expect(starts, "the recording opens nothing").toBe(0)
		for (const hash of ["#live", "#recorded", "#proving", "#live"]) await goTo(hash)
		await act(async () => opened({} as DemoWallet))
		expect(starts).toBe(1)
	})
})
