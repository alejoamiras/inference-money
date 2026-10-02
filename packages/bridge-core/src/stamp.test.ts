import { describe, expect, it } from "bun:test"
import { poseidon2HashBytes } from "@aztec-labs/foundation/crypto/sync"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { DOM_SEP__MERCHANT_STAMP, DOM_SEP__MERCHANT_STAMP_PAD, MERCHANT_SIDE_SLOT, pad, REQUEST_OPENED_EFFECT, stamp } from "./stamp"

// The same literals as contracts/aztec/keystone: a drift makes every payment into a stamped request unprovable.
describe("merchant stamps (cross-toolchain vectors)", () => {
	const hash = (s: string) => poseidon2HashBytes(Buffer.from(s))
	const u32 = (s: string) => Number(hash(s).toBigInt() & 0xffff_ffffn)

	it("the separators, the capsule slot and the effect tag equal their runtime derivations", () => {
		expect(DOM_SEP__MERCHANT_STAMP).toBe(u32("dom_sep__merchant_token_stamp"))
		expect(DOM_SEP__MERCHANT_STAMP_PAD).toBe(u32("dom_sep__merchant_token_stamp_pad"))
		expect(MERCHANT_SIDE_SLOT.equals(hash("merchant_token_side_hint_capsule_slot"))).toBe(true)
		expect(REQUEST_OPENED_EFFECT.equals(hash("merchant_token_request_opened"))).toBe(true)
	})

	it.each([
		[
			0n,
			"0x10590c7bccccb48d97692fb2528ca43554d6b12622e28b131d42b347901e4b89",
			"0x250314702e0895fb86c6891bf980397f03d9b03867023ad8e3772a6221f3a23a",
		],
		[
			0x1234n,
			"0x04f721388a805f610d777fd9a4d80c760cb690ab6ee8d6f87b1ba15df910a4cd",
			"0x23662d79d573c0597e92623a6bfc4d11dcb41fd3c0d34b54bff4eadaafdc3c9b",
		],
	] as const)("stamp and pad of %d match the keystone", (c, s, p) => {
		expect(stamp(new Fr(c)).toString()).toBe(s)
		expect(pad(new Fr(c)).toString()).toBe(p)
	})
})
