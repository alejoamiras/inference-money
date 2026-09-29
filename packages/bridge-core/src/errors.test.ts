import { describe, expect, it } from "bun:test"
import { isUserRejection, type RetrySession, retryOnUnregistered, walletErrorCodeOf } from "./errors"

const envelope = (code: string) => JSON.stringify({ message: "x", data: { walletErrorCode: code } })
const unregistered = () => new Error(envelope("CONTRACT_NOT_REGISTERED"))

describe("walletErrorCodeOf", () => {
	it("decodes both transports, and never a third level", () => {
		expect(walletErrorCodeOf(new Error(envelope("PXE_STALE_ANCHOR")))).toBe("PXE_STALE_ANCHOR")
		expect(walletErrorCodeOf(new Error(JSON.stringify(envelope("PXE_STALE_ANCHOR"))))).toBe("PXE_STALE_ANCHOR")
		expect(walletErrorCodeOf(new Error(JSON.stringify(JSON.stringify(envelope("X")))))).toBeUndefined()
		expect(walletErrorCodeOf(new Error("CONTRACT_NOT_REGISTERED"))).toBeUndefined()
	})
})

describe("retryOnUnregistered", () => {
	const walletA = { id: "a" }
	const session = (current: () => object | null) => {
		const s = {
			current,
			reregistered: 0,
			reregisterContracts: async () => {
				s.reregistered++
				return true
			},
		}
		return s satisfies RetrySession<object>
	}

	it("re-registers once and retries on the structured code", async () => {
		const s = session(() => walletA)
		let calls = 0
		const r = await retryOnUnregistered(s, walletA, async () => {
			if (calls++ === 0) throw unregistered()
			return "sent"
		})
		expect(r).toBe("sent")
		expect(s.reregistered).toBe(1)
	})

	it("rethrows without re-registering on any other error, or when the session swapped wallets", async () => {
		const plain = session(() => walletA)
		await expect(
			retryOnUnregistered(plain, walletA, async () => {
				throw new Error("contract not registered")
			}),
		).rejects.toThrow("contract not registered")
		const swapped = session(() => ({ id: "b" }))
		await expect(retryOnUnregistered(swapped, walletA, async () => Promise.reject(unregistered()))).rejects.toThrow(
			"CONTRACT_NOT_REGISTERED",
		)
		expect(plain.reregistered + swapped.reregistered).toBe(0)
	})

	it("retries at most once", async () => {
		const s = session(() => walletA)
		let calls = 0
		await expect(
			retryOnUnregistered(s, walletA, async () => {
				calls++
				throw unregistered()
			}),
		).rejects.toThrow("CONTRACT_NOT_REGISTERED")
		expect(calls).toBe(2)
	})
})

describe("isUserRejection", () => {
	it("matches explicit refusals anywhere in the cause chain, and nothing ambiguous", () => {
		expect(isUserRejection(new Error("wrapped", { cause: { code: 4001 } }))).toBe(true)
		expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true)
		expect(isUserRejection(new Error("Transaction rejected by user"))).toBe(true)
		expect(isUserRejection(new Error("fetch failed"))).toBe(false)
		expect(isUserRejection(new Error("rejected"))).toBe(false)
	})
})
