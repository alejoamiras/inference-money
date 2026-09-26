import { describe, expect, it } from "bun:test"
import { assertSmokeComplete, pendingExits, type SmokeState } from "./smoke"

const exit = (o: { verified?: boolean; withdrawn?: boolean } = {}) => ({
	tx: "0x01",
	recipient: "0x00000000000000000000000000000000000000e1" as const,
	amount: "1000000",
	verified: o.verified ?? true,
	withdrawn: o.withdrawn ?? false,
})

describe("smoke state", () => {
	it("resumes only unwithdrawn exits, and passes only when both exits were verified and withdrawn", () => {
		const interrupted: SmokeState = { bridge: "0xb", exits: { public: exit() } }
		expect(pendingExits(interrupted)).toEqual(["public"])
		interrupted.exits.public = exit({ withdrawn: true })
		expect(pendingExits(interrupted)).toEqual([])
		expect(() => assertSmokeComplete(interrupted)).toThrow("private exit did not complete")

		const unverified: SmokeState = {
			bridge: "0xb",
			exits: { public: exit({ withdrawn: true }), private: exit({ verified: false, withdrawn: true }) },
		}
		expect(() => assertSmokeComplete(unverified)).toThrow("private exit did not complete")
		unverified.exits.private = exit({ withdrawn: true })
		expect(() => assertSmokeComplete(unverified)).not.toThrow()
	})
})
