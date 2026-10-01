// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createInFlight } from "./pending"

const leave = (target: EventTarget) => {
	const e = new Event("beforeunload", { cancelable: true })
	target.dispatchEvent(e)
	return e.defaultPrevented
}

describe("createInFlight", () => {
	it("asks before unloading exactly while something is in flight", () => {
		const target = new EventTarget()
		const inFlight = createInFlight(target)
		const [a, b] = [{}, {}]
		expect(leave(target)).toBe(false)
		inFlight.add(a)
		inFlight.add(b)
		expect(leave(target)).toBe(true)
		inFlight.remove(a)
		expect(leave(target)).toBe(true)
		inFlight.remove(b)
		inFlight.remove(b)
		expect(leave(target)).toBe(false)
		expect(inFlight.size).toBe(0)
	})
})
