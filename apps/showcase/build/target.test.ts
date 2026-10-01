// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import fixture from "../src/test/manifest.fixture.json"
import { cspFor, headersFile, resolveTarget } from "./target"

const root = mkdtempSync(join(tmpdir(), "showcase-target-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const demo = (bridge: string) => JSON.stringify({ version: 1, bridge, usersTag: "ab".repeat(16) })

const testnet = join(root, "testnet.json")
writeFileSync(testnet, JSON.stringify({ ...fixture, network: "testnet" }))
writeFileSync(join(root, "testnet-demo.json"), demo(fixture.l2.bridge.address))
const local = join(root, "local", "run-1", "manifest.json")
mkdirSync(join(root, "local", "run-1"), { recursive: true })
writeFileSync(local, JSON.stringify({ ...fixture, network: "local" }))
writeFileSync(join(root, "local", "run-1", "demo.json"), demo(fixture.l2.bridge.address))
/** A local manifest's L1 RPC comes from its run's network; attached endpoints stand in for one. */
const ANVIL = { NET_L1_RPC: "http://127.0.0.1:8545", NET_NODE_URL: "http://127.0.0.1:8080" }

describe("resolveTarget", () => {
	it("pins the testnet build to the committed manifest, refuses every override and every keyed variable", () => {
		expect(() => resolveTarget({ BRIDGE_TARGET: "testnet", BRIDGE_MANIFEST: local }, root)).toThrow(/unset BRIDGE_MANIFEST/)
		expect(() => resolveTarget({ BRIDGE_TARGET: "mainnet" }, root)).toThrow(/Unknown BRIDGE_TARGET/)
		expect(() => resolveTarget({ BRIDGE_MANIFEST: testnet, SEPOLIA_RPC_URL: "https://k" }, root)).toThrow(
			/keyless: unset SEPOLIA_RPC_URL/,
		)
		expect(() => resolveTarget({ BRIDGE_MANIFEST: testnet, SHOWCASE_PROOFS: "fake" }, root)).toThrow(/proves for real/)
		expect(() => resolveTarget({}, join(root, "nowhere"))).toThrow(/No bridge manifest at .*deployments\/testnet\.json/)
	})

	it("needs the deployment's own published demo, and fakes proofs on local unless asked for real ones", () => {
		writeFileSync(join(root, "testnet-demo.json"), demo(`0x${"cd".repeat(32)}`))
		expect(() => resolveTarget({ BRIDGE_MANIFEST: testnet }, root)).toThrow(/no published demo/)
		writeFileSync(join(root, "testnet-demo.json"), demo(fixture.l2.bridge.address))

		expect(resolveTarget({ BRIDGE_MANIFEST: local, ...ANVIL }, root)).toMatchObject({ proofs: "fake", l1RpcUrl: ANVIL.NET_L1_RPC })
		expect(resolveTarget({ BRIDGE_MANIFEST: local, SHOWCASE_PROOFS: "real", ...ANVIL }, root).proofs).toBe("real")
		expect(resolveTarget({ BRIDGE_MANIFEST: testnet }, root)).toMatchObject({ proofs: "real", usersTag: "ab".repeat(16) })
	})
})

describe("served headers", () => {
	it("isolate the page, frame nothing, and reach only the node and the L1 RPC, plus the CRS hosts when proving", () => {
		const node = new URL(fixture.l2.nodeUrl).origin
		const faked = resolveTarget({ BRIDGE_MANIFEST: local, ...ANVIL }, root)
		expect(cspFor(faked)).toContain(`connect-src 'self' data: blob: ${node} http://127.0.0.1:8545;`)
		expect(cspFor(faked)).toContain("frame-src 'none'")
		expect(cspFor(faked)).toContain("frame-ancestors 'none'")
		const shipped = resolveTarget({ BRIDGE_MANIFEST: testnet }, root)
		expect(cspFor(shipped)).toContain(
			`connect-src 'self' data: blob: ${node} https://ethereum-sepolia-rpc.publicnode.com https://crs.aztec-cdn.foundation https://crs.aztec-labs.com;`,
		)
		expect(headersFile(shipped)).toMatch(
			/^\/\*\n {2}Cross-Origin-Opener-Policy: same-origin\n {2}Cross-Origin-Embedder-Policy: require-corp\n/,
		)
	})
})
