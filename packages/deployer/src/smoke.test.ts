import { describe, expect, it } from "bun:test"
import { adoptState, assertSmokeComplete, pendingExits, type SmokeState } from "./smoke"

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

	it("keeps another deployment's pending exits instead of discarding their only record", () => {
		const old: SmokeState = { bridge: "0xold", exits: { public: exit({ withdrawn: true }), private: exit() } }
		expect(() => adoptState(old, "0xnew")).toThrow("pending private exit of bridge 0xold")
		old.exits.private = exit({ withdrawn: true })
		expect(adoptState(old, "0xnew")).toEqual({ bridge: "0xnew", exits: {} })
		expect(adoptState(old, "0xold")).toBe(old as SmokeState)
		expect(adoptState(undefined, "0xnew")).toEqual({ bridge: "0xnew", exits: {} })
	})
})
