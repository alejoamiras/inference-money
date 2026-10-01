import { Fq, type Fr } from "@aztec-labs/aztec.js/fields"
import { concat, hexToBytes, sha256, toBytes } from "viem"

const DOMAIN = toBytes("inference-money/schnorr-signing-key")

/**
 * The Schnorr signing key of every account this repo derives from a secret, so the secret alone rebuilds the account
 * anywhere, a browser included. Changing it moves every such address, the deployers' and the demo cast's.
 */
export function signingKeyFor(secret: Fr): Fq {
	return Fq.fromBufferReduce(Buffer.from(hexToBytes(sha256(concat([DOMAIN, secret.toBuffer()])))))
}
