import { getSchnorrAccountContractAddress } from "@aztec-labs/accounts/schnorr/lazy"
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { type Fq, Fr } from "@aztec-labs/aztec.js/fields"
import { type BridgeManifest, signingKeyFor } from "@inference-money/bridge-core"
import { type Address, bytesToHex, type Hex, numberToHex, sha256, toBytes } from "viem"
import { privateKeyToAddress } from "viem/accounts"
import { z } from "zod"

export const USERS = ["alice", "bob"] as const
export const MERCHANTS = ["galactica", "supplier"] as const
export const ACTORS = [...USERS, ...MERCHANTS] as const
export type User = (typeof USERS)[number]
export type Merchant = (typeof MERCHANTS)[number]
export type Actor = User | Merchant

export const isUser = (a: Actor): a is User => (USERS as readonly string[]).includes(a)

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const TAG = /^[0-9a-f]{32}$/

/** Every demo key is public (the showcase ships them): sha256 of a path that names the deployment. */
const digest = (path: string): bigint => BigInt(sha256(toBytes(`inference-money/demo/${path}`)))

/**
 * An actor's Aztec secret. A merchant's derives from the deployment alone; a user's also takes the users' tag, which
 * `demo setup` draws and publishes only once both users are bound, so nobody can bind a user account before the demo.
 */
export function aztecSecret(bridge: Hex, actor: Actor, tag?: string): Fr {
	if (!isUser(actor)) return new Fr(digest(`${bridge}/${actor}/aztec`) % Fr.MODULUS)
	if (tag === undefined || !TAG.test(tag)) throw new Error(`${actor}'s key needs the users' tag (32 lowercase hex characters)`)
	return new Fr(digest(`${bridge}/${tag}/${actor}/aztec`) % Fr.MODULUS)
}

/** An actor's Ethereum key, in [1, n): A_demo is alice's and B_demo is bob's. */
export const ethereumKey = (bridge: Hex, actor: Actor): Hex =>
	numberToHex((digest(`${bridge}/${actor}/ethereum`) % (SECP256K1_N - 1n)) + 1n, { size: 32 })

/** A fresh users' tag for `demo setup` (`--rotate` draws a new one). */
export const newUsersTag = (): string => bytesToHex(crypto.getRandomValues(new Uint8Array(16))).slice(2)

export interface CastMember {
	actor: Actor
	secret: Fr
	signingKey: Fq
	ethereumKey: Hex
	ethereum: Address
}

export function castMember(m: BridgeManifest, actor: Actor, tag?: string): CastMember {
	const secret = aztecSecret(m.l2.bridge.address, actor, tag)
	const key = ethereumKey(m.l2.bridge.address, actor)
	return { actor, secret, signingKey: signingKeyFor(secret), ethereumKey: key, ethereum: privateKeyToAddress(key) }
}

/** The member's Schnorr account at salt 0: the address `createSchnorrAccount(secret, 0, signingKey)` registers. */
export const aztecAddressOf = (c: Pick<CastMember, "secret" | "signingKey">): Promise<AztecAddress> =>
	getSchnorrAccountContractAddress(c.signingKey, Fr.ZERO, c.secret)

/** `deployments/testnet-demo.json` (a local run keeps its own): which deployment, and the published users' tag. */
export const demoFileSchema = z.strictObject({
	version: z.literal(1),
	bridge: z.string().regex(/^0x[0-9a-f]{64}$/),
	usersTag: z.string().regex(TAG),
})
export type DemoFile = z.infer<typeof demoFileSchema>
