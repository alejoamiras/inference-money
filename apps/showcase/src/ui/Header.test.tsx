import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import { Header, modeOf } from "./Header"

describe("Header", () => {
	it("opens on Try it yourself: the bare URL and old #live links, everything but #recorded", () => {
		expect(["", "#", "#live", "#elsewhere"].map(modeOf)).toEqual(["live", "live", "live", "live"])
		expect(modeOf("#recorded")).toBe("tour")
	})

	it.each([
		["live", "Watch a recorded run", "tour"],
		["tour", "Try it yourself", "live"],
	] as const)("on %s, its one link reads %j and leads to %s", (mode, label, other) => {
		render(<Header network="Local network · proofs off" mode={mode} />)
		const link = screen.getByTestId(TESTIDS.mode)
		expect(link).toHaveTextContent(label)
		expect(modeOf(link.getAttribute("href") ?? "")).toBe(other)
	})
})
