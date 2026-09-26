import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { Readable, Writable } from "node:stream"
import { loadTestnetSecrets, secretNeedles } from "./secrets"

/** Set in the child's env only; never a secret. */
export const REDACTED_CHILD = "INFERENCE_MONEY_REDACTED_CHILD"

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function redact(text: string, needles: string[]): string {
	return needles.reduce((out, n) => out.replace(new RegExp(escapeRegExp(n), "gi"), "[redacted]"), text)
}

/** The testnet secrets and the env's RPC URL, in every form output could carry them. */
export function outputNeedles(repoRoot: string): string[] {
	const hasFile = existsSync(resolve(repoRoot, ".env.testnet"))
	return secretNeedles(hasFile ? loadTestnetSecrets(repoRoot) : {})
}

/** Secrets hold no newline, so redacting whole lines never lets one straddle two writes. */
function pipeRedacted(from: Readable, to: Writable, needles: string[]): Promise<void> {
	let pending = ""
	from.setEncoding("utf8")
	from.on("data", (chunk: string) => {
		const lines = (pending + chunk).split("\n")
		pending = lines.pop() ?? ""
		if (lines.length > 0) to.write(redact(`${lines.join("\n")}\n`, needles))
	})
	return new Promise((done) =>
		from.on("end", () => {
			if (pending) to.write(redact(pending, needles))
			done()
		}),
	)
}

/**
 * Runs `argv` under this runtime with stdout and stderr redacted line by line. Dependency loggers write to the fds
 * directly, so only a pipe catches everything; the child reads its secrets itself, never from argv or env.
 */
export async function runRedacted(
	argv: string[],
	needles: string[],
	out: Writable = process.stdout,
	err: Writable = process.stderr,
): Promise<number> {
	const child = spawn(process.execPath, argv, { env: { ...process.env, [REDACTED_CHILD]: "1" }, stdio: ["inherit", "pipe", "pipe"] })
	const forward = (sig: NodeJS.Signals) => child.kill(sig)
	process.on("SIGINT", forward).on("SIGTERM", forward)
	const piped = Promise.all([pipeRedacted(child.stdout, out, needles), pipeRedacted(child.stderr, err, needles)])
	const code = await new Promise<number>((done) => child.on("close", (c) => done(c ?? 1)))
	await piped
	process.off("SIGINT", forward).off("SIGTERM", forward)
	return code
}

/** An error and its causes, one line each: the CLI's only error output. */
export function describeError(e: unknown): string {
	const lines: string[] = []
	for (let c: unknown = e, depth = 0; c !== undefined && depth < 8; depth++) {
		lines.push(c instanceof Error ? `${c.name}: ${c.message}` : String(c))
		c = c instanceof Error ? c.cause : undefined
	}
	return lines.join("\n  caused by: ")
}
