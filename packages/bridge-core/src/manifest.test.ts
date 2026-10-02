import { describe, expect, it } from "bun:test"
import { parseManifest } from "./manifest"
import { a, f, MANIFEST } from "./test/fixtures"

describe("manifest schema", () => {
	it("accepts a well-formed manifest", () => {
		expect(parseManifest(structuredClone(MANIFEST))).toEqual(MANIFEST)
	})

	it("rejects an unknown field at any depth, and a missing one", () => {
		expect(() => parseManifest({ ...MANIFEST, extra: 1 })).toThrow(/Unrecognized key/)
		expect(() => parseManifest({ ...MANIFEST, l1: { ...MANIFEST.l1, feeJuicePortal: a(9) } })).toThrow(/l1: Unrecognized key/)
		const { router: _, ...l1 } = MANIFEST.l1
		expect(() => parseManifest({ ...MANIFEST, l1 })).toThrow(/l1\.router/)
	})

	it("refuses another protocol version, and an interim admin without an admin", () => {
		expect(() => parseManifest({ ...MANIFEST, protocolVersion: 1 })).toThrow(/protocolVersion/)
		const { admin: _, ...l2 } = MANIFEST.l2
		expect(() => parseManifest({ ...MANIFEST, l2: { ...l2, interimAdmin: true } })).toThrow(/an interim admin needs an admin/)
	})

	it("rejects instances not bound to one non-zero deployer", () => {
		const mixed = structuredClone(MANIFEST)
		mixed.l2.token.deployer = f(0xe)
		expect(() => parseManifest(mixed)).toThrow(/one non-zero deployer/)
		const universal = structuredClone(MANIFEST)
		for (const k of ["proxy", "token", "bridge"] as const) universal.l2[k].deployer = f(0)
		expect(() => parseManifest(universal)).toThrow(/one non-zero deployer/)
	})
})
