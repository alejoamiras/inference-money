import { describe, expect, it } from "bun:test"
import { poseidon2HashBytes } from "@aztec/foundation/crypto/sync"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { claimSecretHash, DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET, deriveClaimSecret } from "./claim-secret"

// The same literals as contracts/aztec/keystone: a drift strands every private deposit made against the derivation.
describe("claim secret (cross-toolchain vectors)", () => {
	it("the separator literal equals its runtime derivation and differs from the protocol secret-hash separator", () => {
		const derived = Number(poseidon2HashBytes(Buffer.from("nulo_dom_sep__token_bridge_private_claim_secret")).toBigInt() & 0xffff_ffffn)
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).toBe(derived)
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).not.toBe(4199652938) // DOM_SEP__SECRET_HASH
	})

	const vectors: { salt: Fr; recipient: AztecAddress; secret: `0x${string}`; secretHash: `0x${string}` }[] = [
		{
			salt: Fr.zero(),
			recipient: AztecAddress.ZERO,
			secret: "0x1bcb2e97aaeb9788f9b23d331c90b0e138b8fa84890f1fb045c4c260b26e1a4f",
			secretHash: "0x087647b3c1976bde1cf12bfa5213c1d619f4f0b9a0bae6e1000d7030fcb9d5fc",
		},
		{
			salt: new Fr(1n),
			recipient: AztecAddress.fromBigIntUnsafe(2n),
			secret: "0x12e754c717173c3dd6f22932580bf8332274034b2c4a6a8ec8d682b482e104a5",
			secretHash: "0x23d9fa16980e66c10886f09780ea412bd1c942a0a6e588d838ea05d7228c6754",
		},
		{
			salt: new Fr(0x1234567890abcdefn),
			recipient: AztecAddress.fromBigIntUnsafe(0xdeadbeefn),
			secret: "0x02c856f2079a8e1cc126d02e81cd409c7ee02e0c4c7cd2dd9450edaa8c681e7d",
			secretHash: "0x2a636f84225eec69e412ed5dffd735f1ac8ff6d28b24dac5d796f0c2a648ac1c",
		},
	]

	it.each(vectors)("derives the pinned secret and hash for salt $salt", async ({ salt, recipient, secret, secretHash }) => {
		expect(deriveClaimSecret(salt, recipient).toString()).toBe(secret)
		expect((await claimSecretHash(salt, recipient)).toString()).toBe(secretHash)
	})

	it("the salt alone makes two deposits to one recipient unlinkable", async () => {
		const recipient = AztecAddress.fromBigIntUnsafe(0xc0ffeen)
		const salt = Fr.random()
		expect((await claimSecretHash(salt, recipient)).toString()).toBe((await claimSecretHash(salt, recipient)).toString())
		expect((await claimSecretHash(Fr.random(), recipient)).toString()).not.toBe((await claimSecretHash(salt, recipient)).toString())
	})
})
