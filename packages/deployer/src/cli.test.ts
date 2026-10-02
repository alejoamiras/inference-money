import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BOOTSTRAP = ["./cli-args", "./redact", "./secrets"]

/** How many child processes this runtime has right after running `setup`. */
function childrenAfter(setup: string): number {
	const count = `const kids = require("node:child_process").spawnSync("pgrep", ["-P", String(process.pid)]).stdout.toString().trim()
console.log(kids ? kids.split("\\n").length : 0)
process.exit(0)`
	const r = Bun.spawnSync([process.execPath, "-e", `${setup}\n${count}`])
	if (r.exitCode !== 0) throw new Error(String(r.stderr))
	return Number(String(r.stdout).trim().split("\n").at(-1))
}

describe("the CLI's entry point", () => {
	it("spawns nothing before it holds the secrets: the SDK, whose import starts bb, loads after", () => {
		const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(readFileSync(join(import.meta.dir, "cli.ts"), "utf8"))
		const of = (kind: string) =>
			scanned
				.filter((i) => i.kind === kind)
				.map((i) => i.path)
				.sort()
		expect(of("import-statement")).toEqual(BOOTSTRAP)
		expect(of("dynamic-import")).toEqual(["./commands"])

		const imports = BOOTSTRAP.map((m) => `await import(${JSON.stringify(join(import.meta.dir, `${m}.ts`))})`).join("\n")
		expect(childrenAfter(imports)).toBe(0)
		expect(childrenAfter(`require("node:child_process").spawn("sleep", ["5"], { detached: true }).unref()`)).toBe(1)
	})
})
