import { afterAll, beforeAll } from "bun:test"
import { closeHarness, INTEGRATION, openHarness } from "../test/harness"

// These specs move their network's clock, so they run on a network of their own and never attach to another run's.
if (INTEGRATION) {
	if (process.env.NET_L1_RPC || process.env.NET_NODE_URL) {
		throw new Error("The clock specs move their network's clock: unset NET_L1_RPC and NET_NODE_URL, and they open their own.")
	}
	beforeAll(() => openHarness((m) => console.log(`[clock] ${m}`)), 900_000)
	afterAll(() => closeHarness(), 300_000)
}
