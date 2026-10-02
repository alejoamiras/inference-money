import { type Hex, numberToHex, sha256, toBytes } from "viem"
import type { Actor } from "./actors"

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** Every demo key is public (the showcase ships them): sha256 of a path that names the deployment. */
export const demoDigest = (path: string): bigint => BigInt(sha256(toBytes(`inference-money/demo/${path}`)))

/** An actor's Ethereum key, in [1, n): A_demo is alice's and B_demo is bob's. */
export const ethereumKey = (bridge: Hex, actor: Actor): Hex =>
	numberToHex((demoDigest(`${bridge}/${actor}/ethereum`) % (SECP256K1_N - 1n)) + 1n, { size: 32 })
