// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import fixture from "../src/test/manifest.fixture.json"
import { cspFor, headersFile, resolveTarget } from "./target"

const root = mkdtempSync(join(tmpdir(), "web-target-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const write = (name: string, network: string) => {
	writeFileSync(join(root, name), JSON.stringify({ ...fixture, network }))
	return join(root, name)
}
const local = write("local.json", "local")
const testnet = write("testnet.json", "testnet")

describe("resolveTarget", () => {
	it("pins the testnet build to the committed manifest and refuses every override", () => {
		expect(() => resolveTarget({ BRIDGE_TARGET: "testnet", BRIDGE_MANIFEST: local }, root)).toThrow(/unset BRIDGE_MANIFEST/)
		expect(() => resolveTarget({ BRIDGE_TARGET: "testnet", WEB_WALLET_URLS: "http://127.0.0.1:1" }, root)).toThrow(/unset/)
		expect(() => resolveTarget({ BRIDGE_TARGET: "mainnet" }, root)).toThrow(/Unknown BRIDGE_TARGET/)
	})

	it("fails with a deploy hint when there is no manifest to embed", () => {
		expect(() => resolveTarget({}, root)).toThrow(/No bridge manifest at .*deployments\/testnet\.json/)
	})

	it("lists iframe wallets only for a local manifest", () => {
		expect(() => resolveTarget({ BRIDGE_MANIFEST: testnet, WEB_WALLET_URLS: "http://127.0.0.1:1" }, root)).toThrow(/local test fixture/)
		expect(() => resolveTarget({ BRIDGE_MANIFEST: local, WEB_WALLET_URLS: "javascript:alert(1)" }, root)).toThrow(/not an http/)
		const t = resolveTarget({ BRIDGE_MANIFEST: local, WEB_WALLET_URLS: "http://127.0.0.1:4001/w, http://127.0.0.1:4002/w" }, root)
		expect(t.webWalletUrls).toEqual(["http://127.0.0.1:4001/w", "http://127.0.0.1:4002/w"])
	})
})

describe("served headers", () => {
	it("isolate the page, frame nothing but the test wallets and reach nothing but the node", () => {
		const shipped = resolveTarget({ BRIDGE_MANIFEST: testnet }, root)
		expect(cspFor(shipped)).toContain("frame-src 'none'")
		expect(cspFor(shipped)).toContain(`connect-src 'self' data: blob: ${new URL(fixture.l2.nodeUrl).origin};`)
		expect(cspFor(shipped)).toContain("frame-ancestors 'none'")
		const e2e = resolveTarget({ BRIDGE_MANIFEST: local, WEB_WALLET_URLS: "http://127.0.0.1:4001/w" }, root)
		expect(cspFor(e2e)).toContain("frame-src http://127.0.0.1:4001;")
		expect(headersFile(shipped)).toMatch(
			/^\/\*\n {2}Cross-Origin-Opener-Policy: same-origin\n {2}Cross-Origin-Embedder-Policy: require-corp\n/,
		)
	})
})
