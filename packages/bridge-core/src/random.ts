import { Fr } from "@aztec-labs/aztec.js/fields"

/**
 * A uniform field element from the platform CSPRNG, for anything that must stay secret. `Fr.random()` is not that
 * source: with SEED in the process environment, the Aztec foundation draws every value from a 32-bit counter.
 */
export function randomSecret(): Fr {
	return Fr.fromBufferReduce(Buffer.from(crypto.getRandomValues(new Uint8Array(64))))
}
