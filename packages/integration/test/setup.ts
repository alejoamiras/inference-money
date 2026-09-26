import { afterAll, beforeAll } from "bun:test"
import { closeHarness, INTEGRATION, openHarness } from "./harness"

// A preload's hooks run once around the whole suite: one network and one deploy for every file.
if (INTEGRATION) {
	beforeAll(() => openHarness((m) => console.log(`[it] ${m}`)), 900_000)
	afterAll(() => closeHarness(), 300_000)
}
