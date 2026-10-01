import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Writable } from "node:stream"
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { signingKeyFor } from "@inference-money/bridge-core"
import { aztecAddressOf } from "@inference-money/demo"
import { REPO_ROOT } from "@inference-money/local-network"
import type { Address } from "viem"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { TESTNET } from "./networks"
import { runRedacted } from "./redact"
import { DISPOSABLE_DIR, keyedWorktree } from "./run-state"
import { scanForSecrets } from "./scan"
import { aztecSecretFrom, KEYED, scrubbedEnv, secretNeedles } from "./secrets"

/** The P9 fallback's keys: owner-only, outside every checkout, until `destroy`. */
export const DISPOSABLE_FILE = join(DISPOSABLE_DIR, "testnet.env")
/** Set in a `disposable exec` child alone: an `admin accept` under it records the admin as interim. */
export const INTERIM_ADMIN = "BRIDGE_INTERIM_ADMIN"
const ADMIN_ADDRESS = "TESTNET_ADMIN_ADDRESS"
const CLI = join(import.meta.dir, "cli.ts")

const accountOf = (secret: Fr): Promise<AztecAddress> => aztecAddressOf({ secret, signingKey: signingKeyFor(secret) })

export interface DisposableAddresses {
	l1: Address
	deployer: AztecAddress
	admin: AztecAddress
}

/**
 * Draws an L1 deploy key, an L2 deployer secret and an interim admin secret into `file` (0600, never overwritten) and
 * returns only the addresses they control. The values never leave this process except through that file.
 */
export async function disposableInit(file = DISPOSABLE_FILE): Promise<DisposableAddresses> {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
	const l1Key = generatePrivateKey()
	const [deployerSecret, adminSecret] = [Fr.random(), Fr.random()]
	const admin = await accountOf(adminSecret)
	const lines = [
		`${KEYED.l1PrivateKey}=${l1Key}`,
		`${KEYED.deployerSecret}=${deployerSecret}`,
		`${KEYED.adminSecret}=${adminSecret}`,
		`${ADMIN_ADDRESS}=${admin}`,
	]
	writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" })
	return { l1: privateKeyToAddress(l1Key), deployer: await accountOf(deployerSecret), admin }
}

/** Refuses a file another user owns or anyone else can read or write, and a symlink, before reading a byte. */
export function assertOwnerOnly(file: string, uid = process.getuid?.()): void {
	const st = lstatSync(file)
	if (!st.isFile()) throw new Error(`${file} is not a regular file`)
	if (st.uid !== uid) throw new Error(`${file} belongs to another user`)
	if ((st.mode & 0o777) !== 0o600) throw new Error(`${file} must be mode 0600, not ${(st.mode & 0o777).toString(8)}`)
}

function readValues(file: string): Record<string, string> {
	assertOwnerOnly(file)
	const entries = readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => l.includes("="))
		.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const)
	return Object.fromEntries(entries)
}

/** Test seams; the CLI passes none. */
export interface ExecOptions {
	file?: string
	/** The checkout this runs in, which must be the keyed worktree, so later edits can't reach the run. */
	root?: string
	keyedRoot?: string
	argv?: (command: string[]) => string[]
	out?: Writable
	err?: Writable
	scan?: typeof scanForSecrets
}

/**
 * Runs one `bridge` command with the disposable values in its environment alone: redacted output, then the secrets
 * scan, which fails the run if any value reached the checkout or the caches. Only from the keyed worktree.
 */
export async function disposableExec(command: string[], opts: ExecOptions = {}): Promise<number> {
	const root = resolve(opts.root ?? REPO_ROOT)
	if (root !== resolve(opts.keyedRoot ?? keyedWorktree())) {
		throw new Error("disposable exec runs from the keyed worktree only: bash scripts/keyed-worktree.sh sync, then run it there")
	}
	if (command[0] === "disposable") throw new Error("disposable exec runs a bridge command, not another disposable one")
	const values = readValues(opts.file ?? DISPOSABLE_FILE)
	const env = { ...scrubbedEnv(), ...values, [KEYED.rpcUrl]: TESTNET.defaultL1RpcUrl, [INTERIM_ADMIN]: "1" }
	const needles = secretNeedles(env)
	const argv = opts.argv ? opts.argv(command) : [CLI, ...command]
	const code = await runRedacted(argv, needles, opts.out ?? process.stdout, opts.err ?? process.stderr, env)
	const scan = (opts.scan ?? scanForSecrets)(root, needles)
	if (scan.found || scan.walletDirs.length > 0) {
		;(opts.err ?? process.stderr).write(`secrets:scan after the run: found=${scan.found} walletDirs=${scan.walletDirs.length}\n`)
		return code === 0 ? 1 : code
	}
	return code
}

/**
 * Deletes the disposable keys, refusing while `manifest` still names their interim admin: with the key gone, nobody
 * could ever hand the role over.
 */
export async function disposableDestroy(file = DISPOSABLE_FILE, manifest = join(REPO_ROOT, "deployments", "testnet.json")): Promise<void> {
	if (!existsSync(file)) return
	const values = readValues(file)
	const admin = (await accountOf(aztecSecretFrom(KEYED.adminSecret, values))).toString()
	// Read raw: a manifest of any protocol version that names this admin blocks the delete.
	const named = existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { l2?: { admin?: string } }).l2?.admin === admin
	if (named) throw new Error(`${manifest} still names the disposable admin ${admin}: switch to the owner's admin first`)
	rmSync(file)
}
