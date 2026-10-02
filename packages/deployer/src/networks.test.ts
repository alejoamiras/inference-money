import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getAddress } from "viem"
import { TESTNET } from "./networks"

// The Sepolia fork suite drives the same live contracts the deployer binds to, so a rollup switch must move both.
const FORK_SUITE = readFileSync(join(import.meta.dir, "../../../contracts/evm/test/SepoliaFork.t.sol"), "utf8")

function forkConstant(name: string): string {
	const value = FORK_SUITE.match(new RegExp(`constant ${name} = ([0-9a-fA-Fx_]+);`))?.[1]
	if (value === undefined) throw new Error(`SepoliaFork.t.sol declares no ${name} constant`)
	return value.replaceAll("_", "")
}

describe("testnet pins", () => {
	it("are the Sepolia fork suite's pins", () => {
		for (const [name, pinned] of [
			["REGISTRY", TESTNET.registry],
			["INBOX", TESTNET.inbox],
			["OUTBOX", TESTNET.outbox],
			["USDC", TESTNET.usdc],
			["PERMIT2", TESTNET.permit2],
		] as const) {
			expect(getAddress(forkConstant(name)), name).toBe(getAddress(pinned))
		}
		expect(Number(forkConstant("ROLLUP_VERSION"))).toBe(TESTNET.rollupVersion)
	})
})
