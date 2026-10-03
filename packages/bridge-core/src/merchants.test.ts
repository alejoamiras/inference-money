import { describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import {
	type MerchantEntry,
	type MerchantList,
	merchantSide,
	merchantStatus,
	paymentSide,
	Side,
	sideCapsule,
	tokenEvent,
} from "./merchants"
import { MERCHANT_SIDE_SLOT } from "./stamp"

const NOW = 1_000n
const [m1, m2, alice, bob] = await Promise.all([AztecAddress.random(), AztecAddress.random(), AztecAddress.random(), AztecAddress.random()])

const on: MerchantEntry = { off: false, scheduledOff: false, changeAt: 0n }
const switchingOff: MerchantEntry = { off: false, scheduledOff: true, changeAt: NOW + 3600n }
const list = (entries: [AztecAddress, MerchantEntry][]): MerchantList => ({
	block: 7,
	at: NOW,
	entries: new Map(entries.map(([a, e]) => [a.toString(), e])),
})

describe("merchant status", () => {
	it("is the old value before the change and the scheduled one from it on", () => {
		const l = list([[m1, switchingOff]])
		expect(merchantStatus(l, m1)).toEqual({ merchant: true, pending: true })
		expect(merchantStatus(l, m1, switchingOff.changeAt - 1n)).toEqual({ merchant: true, pending: true })
		expect(merchantStatus(l, m1, switchingOff.changeAt)).toEqual({ merchant: false, pending: false })
		expect(merchantStatus(l, alice)).toEqual({ merchant: false, pending: false })
	})
})

// The same three rules as the token's hint (contracts/aztec/token/src/hints.nr); `first` is the recipient.
describe("the side a call proves", () => {
	const one = list([[m1, on]])
	const firstPending = list([
		[m1, switchingOff],
		[m2, on],
	])
	const bothPending = list([
		[m1, switchingOff],
		[m2, switchingOff],
	])

	it("keeps any merchant side, and is Neither only between users", () => {
		expect(merchantSide(one, m1, alice, false)).toBe(Side.First)
		expect(merchantSide(one, alice, m1, false)).toBe(Side.Second)
		expect(merchantSide(one, alice, bob, false)).toBe(Side.Neither)
		expect(merchantSide(bothPending, m1, m2, false)).toBe(Side.First)
	})

	it("prefers the merchant with nothing pending, except a request's merchant recipient", () => {
		expect(merchantSide(firstPending, m1, m2, false)).toBe(Side.Second)
		expect(merchantSide(firstPending, m1, m2, true)).toBe(Side.First)
	})

	it("proves a fresh stamp, else a merchant payer, else a live stamp, and refuses a user with no live stamp", () => {
		expect([paymentSide(one, "fresh", m1), paymentSide(one, "fresh", alice)]).toEqual([Side.First, Side.First])
		expect([paymentSide(one, "live", m1), paymentSide(one, "live", alice)]).toEqual([Side.Second, Side.First])
		expect([paymentSide(one, "none", m1), paymentSide(one, "none", alice)]).toEqual([Side.Second, Side.Neither])
	})

	it("is carried in the token's capsule slot", () => {
		const capsule = sideCapsule(m1, Side.Second)
		expect(capsule.contractAddress.equals(m1)).toBe(true)
		expect(capsule.storageSlot.equals(MERCHANT_SIDE_SLOT)).toBe(true)
		expect(capsule.data.map((f) => f.toBigInt())).toEqual([1n])
	})
})

describe("token events", () => {
	// aztec-standards' codegen pins Transfer's selector; deriving it the same way proves the method for MerchantAdded.
	it("derive the selector aztec's codegen pins", async () => {
		expect((await tokenEvent("Transfer")).eventSelector.toString()).toBe("0x70a1894e")
		await expect(tokenEvent("Missing")).rejects.toThrow(/no Token::Missing event/)
	})
})
