// Fails fast, with a fix hint, when a foundry.toml remapping does not resolve through this package's node_modules
// (a missing `bun install`, or a linker that stopped creating per-package symlinks), and when forge's effective
// remappings differ from the declared ones. Without it the symptom is an opaque solc "Source not found".
import { existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

type FoundryToml = { profile: { default: { remappings: string[] } } }

export function remappingProblems(declared: string[], effective: string[], exists: (p: string) => boolean): string[] {
	const problems: string[] = []
	for (const entry of declared) {
		const target = entry.split("=")[1]
		if (!target || !exists(target)) problems.push(`${entry}: target does not exist (run \`bun install\`)`)
	}
	const want = [...declared].sort().join("\n")
	const got = [...effective].sort().join("\n")
	if (want !== got) problems.push(`forge applies different remappings than foundry.toml declares:\n${got}`)
	return problems
}

if (import.meta.main) {
	const toml = Bun.TOML.parse(await Bun.file(join(ROOT, "foundry.toml")).text()) as FoundryToml
	const forge = Bun.spawnSync(["forge", "remappings", "--root", ROOT])
	if (forge.exitCode !== 0) throw new Error(`forge remappings failed: ${forge.stderr.toString()}`)
	const effective = forge.stdout.toString().trim().split("\n").filter(Boolean)
	const problems = remappingProblems(toml.profile.default.remappings, effective, (p) => existsSync(join(ROOT, p)))
	if (problems.length > 0) {
		console.error(problems.join("\n"))
		process.exit(1)
	}
}
