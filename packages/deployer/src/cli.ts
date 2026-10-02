import { type Invocation, parseInvocation, USAGE } from "./cli-args"
import { describeError, REDACTED_CHILD, runRedacted } from "./redact"
import { holdSecrets, secretNeedles } from "./secrets"

/**
 * The entry point stays free of the Aztec SDK: importing it starts a native bb process with this process's
 * environment, so the handlers load only once the secrets are held.
 */
async function main(): Promise<number> {
	let inv: Invocation
	try {
		inv = parseInvocation(process.argv.slice(2))
	} catch (e) {
		console.error(e instanceof Error ? e.message : USAGE)
		return 2
	}
	// The Aztec SDK reads SEED when it loads, from the shell or a `.env` Bun auto-loads, and then draws every random value,
	// its own secrets and nonces included, from a 32-bit counter.
	if (process.env.SEED) {
		console.error("SEED is set, which makes the Aztec SDK's randomness predictable: unset it (check for a .env file) and retry")
		return 2
	}
	const needles = secretNeedles()
	// Any environment holding a secret runs the command as a child whose output is redacted line by line.
	if (needles.length > 0 && process.env[REDACTED_CHILD] !== "1") return runRedacted(process.argv.slice(1), needles)
	holdSecrets()
	const { HANDLERS } = await import("./commands")
	return HANDLERS[inv.command](inv)
}

if (import.meta.main) {
	try {
		process.exit(await main())
	} catch (e) {
		console.error(describeError(e))
		process.exit(1)
	}
}
