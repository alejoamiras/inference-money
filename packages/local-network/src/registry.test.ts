import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { claimNetPorts } from "./ports"
import { claimPorts, PortClaimConflict, registeredPorts, releasePorts, setPidHint } from "./registry"

let dir: string
let path: string
beforeEach(() => {
	dir = mkdtempSync(join(homedir(), ".cache", "inference-money-registry-test-"))
	path = join(dir, "ports.md")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const DEAD_PID = 2 ** 22 + 7
const claim = (runId: string, ports: Record<string, number>, o: { label?: string; pidHint?: number } = {}) =>
	claimPorts({ runId, label: o.label ?? "inference-money-net", ports, pidHint: o.pidHint ?? process.pid, worktree: "/w" }, path)

describe("port registry", () => {
	it("claims under one lock, refuses a port already listed, and releases only the owner's rows", async () => {
		await Promise.all([claim("a", { anvil: 10_001, aztec: 10_002 }), claim("b", { anvil: 10_003 })])
		expect(registeredPorts(path)).toEqual(new Set([10_001, 10_002, 10_003]))

		const before = readFileSync(path, "utf8")
		await expect(claim("c", { anvil: 10_004, aztec: 10_002 })).rejects.toBeInstanceOf(PortClaimConflict)
		expect(readFileSync(path, "utf8")).toBe(before)

		await releasePorts("a", path)
		expect(registeredPorts(path)).toEqual(new Set([10_003]))
	})

	it("reaps dead-owner rows of its own label only, and re-points a run's rows at a new pid", async () => {
		await claim("dead-ours", { anvil: 10_010 }, { pidHint: DEAD_PID })
		await claim("dead-theirs", { anvil: 10_011 }, { pidHint: DEAD_PID, label: "someone-else" })
		await claim("live", { anvil: 10_012 })
		expect(registeredPorts(path)).toEqual(new Set([10_011, 10_012]))

		await setPidHint("live", DEAD_PID, path)
		expect(readFileSync(path, "utf8")).toContain(`| 10012 | inference-money-net-anvil | live | /w | ${DEAD_PID} |`)
	})

	it("gives concurrent runs disjoint port sets", async () => {
		const [a, b] = await Promise.all([claimNetPorts("ra", process.pid, "/w", path), claimNetPorts("rb", process.pid, "/w", path)])
		const all = [...Object.values(a), ...Object.values(b)]
		expect(new Set(all).size).toBe(8)
		expect(registeredPorts(path)).toEqual(new Set(all))
	})
})
