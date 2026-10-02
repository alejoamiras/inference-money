import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { groupState, type Spawned, spawnDetached, stopOwnedGroup } from "./process"

const dir = mkdtempSync(join(homedir(), ".cache", "inference-money-process-test-"))
const spawned: Spawned[] = []
afterEach(async () => {
	for (const p of spawned.splice(0)) await stopOwnedGroup(p, 1_000).catch(() => {})
})

const membersOf = (pgid: number) =>
	execFileSync("ps", ["-eo", "pgid="], { encoding: "utf8" })
		.split("\n")
		.filter((l) => Number(l.trim()) === pgid).length

describe("owned process groups", () => {
	it("stops the whole group, grandchildren included, and then reports it gone", async () => {
		const p = await spawnDetached("pair", "sh", ["-c", "sleep 60 & sleep 60"], { env: process.env, logFile: join(dir, "pair.log") })
		spawned.push(p)
		await new Promise((r) => setTimeout(r, 200))
		expect(groupState(p)).toBe("ours")
		expect(membersOf(p.pgid)).toBeGreaterThanOrEqual(2)

		expect(await stopOwnedGroup(p, 2_000)).toBe("stopped")
		expect(membersOf(p.pgid)).toBe(0)
		expect(groupState(p)).toBe("gone")
	})

	it("never signals a group whose leader's start time differs from the record", async () => {
		const p = await spawnDetached("victim", "sleep", ["60"], { env: process.env, logFile: join(dir, "victim.log") })
		spawned.push(p)
		const impostor = { ...p, started: "Thu Jan  1 00:00:00 1970" }
		expect(groupState(impostor)).toBe("reused")
		expect(await stopOwnedGroup(impostor)).toBe("reused")
		expect(groupState(p)).toBe("ours")
	})

	it("still owns its group from a shell in another time zone, whichever zone the record was written in", async () => {
		const p = await spawnDetached("zoned", "sleep", ["60"], { env: process.env, logFile: join(dir, "zoned.log") })
		spawned.push(p)
		const tz = process.env.TZ
		try {
			process.env.TZ = "Asia/Tokyo"
			const local = execFileSync("ps", ["-o", "lstart=", "-p", String(p.pgid)], { encoding: "utf8" }).trim()
			expect(local).not.toBe(p.started)
			expect(groupState(p)).toBe("ours")
			expect(groupState({ ...p, started: local })).toBe("ours")
		} finally {
			if (tz === undefined) delete process.env.TZ
			else process.env.TZ = tz
		}
	})

	it("once the leader exits, owns the group only through a member carrying its marker", async () => {
		const p = await spawnDetached("orphans", "sh", ["-c", "sleep 60 & exit 0"], { env: process.env, logFile: join(dir, "orphans.log") })
		spawned.push(p)
		await new Promise((r) => setTimeout(r, 300))
		expect(membersOf(p.pgid)).toBe(1)
		expect(groupState({ ...p, marker: "another-run" })).toBe("reused")
		expect(await stopOwnedGroup({ ...p, marker: "another-run" })).toBe("reused")
		expect(groupState(p)).toBe("ours")
		expect(await stopOwnedGroup(p, 2_000)).toBe("stopped")
		expect(membersOf(p.pgid)).toBe(0)
	})

	it("a leaderless group whose members carry no marker at all is unverified, never assumed reused", async () => {
		const p = await spawnDetached("bare", "sh", ["-c", "env -i sleep 60 & exit 0"], {
			env: process.env,
			logFile: join(dir, "bare.log"),
		})
		spawned.push(p)
		await new Promise((r) => setTimeout(r, 300))
		expect(groupState(p)).toBe("unverified")
		expect(await stopOwnedGroup(p)).toBe("unverified")
		expect(membersOf(p.pgid)).toBe(1)
		process.kill(-p.pgid, "SIGKILL")
	})

	it("kills the group it just spawned when its identity cannot be read", async () => {
		const path = process.env.PATH
		process.env.PATH = "/nonexistent"
		const failed = spawnDetached("blind", "/bin/sleep", ["3141"], { env: { PATH: path }, logFile: join(dir, "blind.log") })
		await expect(failed).rejects.toThrow("could not start")
		process.env.PATH = path
		await new Promise((r) => setTimeout(r, 200))
		expect(execFileSync("ps", ["-eo", "args="], { encoding: "utf8" })).not.toContain("sleep 3141")
	})

	it("rejects a missing binary with its log path, and exposes a quick death through exitCode", async () => {
		const missing = spawnDetached("gone", join(dir, "no-such-bin"), [], { env: process.env, logFile: join(dir, "gone.log") })
		await expect(missing).rejects.toThrow(/gone\.log/)

		const quick = await spawnDetached("quick", "sh", ["-c", "exit 3"], { env: process.env, logFile: join(dir, "quick.log") })
		await new Promise((r) => setTimeout(r, 200))
		expect(quick.exitCode()).toBe(3)
		rmSync(dir, { recursive: true, force: true })
	})
})
