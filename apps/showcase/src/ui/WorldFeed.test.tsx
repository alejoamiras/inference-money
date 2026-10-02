import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TOUR } from "@/config/network"
import { TESTIDS } from "@/lib/testids"
import { playTour } from "@/tour/player"
import { WorldFeed } from "./WorldFeed"

describe("WorldFeed", () => {
	const rows = playTour(TOUR).flatMap((p) => p.rows)

	it("shows each recorded field as the decoder marked it: readable with its value, hidden with none", () => {
		render(<WorldFeed rows={rows} />)
		for (const row of screen.getAllByTestId(TESTIDS.feedRow)) {
			const recorded = rows.find((r) => r.key === row.dataset.step)?.items ?? []
			const shown = [...row.querySelectorAll<HTMLElement>("li[data-visibility]")]
			expect(shown.map((el) => el.dataset.visibility)).toEqual(recorded.map((w) => w.visibility))
			for (const [i, w] of recorded.entries()) {
				if (w.visibility === "hidden") expect(shown[i]).toHaveTextContent(`hidden: ${w.label}`)
				else expect(shown[i]?.textContent).toMatch(new RegExp(`^${w.label}: \\S`))
			}
		}
	})

	it("reads amounts in USDC, expiries in UTC, and shortens addresses", () => {
		render(<WorldFeed rows={rows} />)
		const deposit = within(screen.getAllByTestId(TESTIDS.feedRow).find((r) => r.dataset.step === "deposit") as HTMLElement)
		expect(deposit.getByText("amount: 10.00 USDC")).toBeInTheDocument()
		expect(deposit.getByText(/^depositor: 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/)).toBeInTheDocument()
		const claim = within(screen.getAllByTestId(TESTIDS.feedRow).find((r) => r.dataset.step === "claim") as HTMLElement)
		expect(claim.getByText(/^expires at: \d\d:\d\d UTC$/)).toBeInTheDocument()
		expect(claim.getByText("hidden: recipient")).toBeInTheDocument()
	})

	it("says so when nothing is public yet", () => {
		render(<WorldFeed rows={[]} />)
		expect(screen.getByText("Nothing public yet: run a step.")).toBeInTheDocument()
	})
})
