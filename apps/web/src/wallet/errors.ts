import { isUserRejection, walletErrorCodeOf } from "@inference-money/bridge-core"

export type ErrorCategory =
	| "user-rejected"
	| "capability-rejected"
	| "no-wallet"
	| "network"
	| "tx-reverted"
	| "no-fee-asset"
	| "account-uninitialized"
	| "contract-not-registered"
	| "chain-desync"
	| "unknown"

export interface NormalizedError {
	readonly category: ErrorCategory
	/** Copy fit for a toast; only the `unknown` category carries the error's own text. */
	readonly message: string
	readonly raw: unknown
}

/** A Map, not an object: the code is wallet-controlled text, and an object lookup would resolve prototype keys. */
const CODE_CATEGORIES: ReadonlyMap<string, ErrorCategory> = new Map([
	["PXE_STALE_ANCHOR", "chain-desync"],
	["CONTRACT_NOT_REGISTERED", "contract-not-registered"],
])

/** Ordered: the first rule whose predicate holds wins, so the capability wording is tested before the generic decline. */
const TEXT_RULES: ReadonlyArray<readonly [(text: string, err: unknown) => boolean, ErrorCategory]> = [
	[(t) => /capabilit/.test(t) && /denied|rejected/.test(t), "capability-rejected"],
	[(t, err) => isUserRejection(err) || /user rejected|user cancelled|user canceled|denied by user/.test(t), "user-rejected"],
	[(t) => /no wallet|wallet not found|no provider/.test(t), "no-wallet"],
	[(t) => /existing nullifier|not initialized|not deployed/.test(t), "account-uninitialized"],
	[(t) => /fee/.test(t) && /sponsored|payment/.test(t), "no-fee-asset"],
	[(t) => /revert/.test(t), "tx-reverted"],
	[(t) => /unknown contract|not registered/.test(t), "contract-not-registered"],
	[(t) => /fetch|network|timeout|econnrefused/.test(t), "network"],
]

const COPY: Readonly<Record<Exclude<ErrorCategory, "unknown">, string>> = {
	"user-rejected": "You declined the request in your wallet.",
	"capability-rejected": "Your wallet declined the permissions USDC Bridge needs. Approve them to continue.",
	"no-wallet": "No Aztec wallet was found. Install one, then reload this page.",
	network: "The network could not be reached. Check your connection and try again.",
	"tx-reverted": "The transaction was rejected by the network.",
	"no-fee-asset": "Your wallet has no way to pay the Aztec transaction fee.",
	"account-uninitialized": "This account is not set up on the Aztec network yet. Deploy it from your wallet first.",
	"contract-not-registered": "Your wallet does not know the bridge contracts yet. Reconnect to register them.",
	"chain-desync": "Your wallet is out of sync with the Aztec network. Wait a moment and try again.",
}

const FALLBACK = "Something went wrong. Try again."

interface ErrorFields {
	message?: unknown
	shortMessage?: unknown
	details?: unknown
	cause?: unknown
}

/** Every message-like string down the cause chain (bounded), lowercased for the rules. */
function textOf(err: unknown): string {
	if (typeof err === "string") return err.toLowerCase()
	const parts: string[] = []
	let current: unknown = err
	for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
		const e = current as ErrorFields
		for (const field of [e.message, e.shortMessage, e.details]) if (typeof field === "string") parts.push(field)
		current = e.cause
	}
	return parts.join("\n").toLowerCase()
}

function categoryOf(err: unknown): ErrorCategory {
	const code = walletErrorCodeOf(err)
	const byCode = code === undefined ? undefined : CODE_CATEGORIES.get(code)
	if (byCode) return byCode
	const text = textOf(err)
	return TEXT_RULES.find(([test]) => test(text, err))?.[1] ?? "unknown"
}

export function normalizeError(err: unknown): NormalizedError {
	const category = categoryOf(err)
	return { category, message: category === "unknown" ? userMessage(err, FALLBACK) : COPY[category], raw: err }
}

/** The most specific text the error carries (viem's `details`, then `shortMessage`, then `message`), else `fallback`. */
export function userMessage(err: unknown, fallback: string): string {
	if (typeof err === "string") return err.trim() || fallback
	if (!err || typeof err !== "object") return fallback
	const e = err as ErrorFields
	for (const field of [e.details, e.shortMessage, e.message]) {
		if (typeof field === "string" && field.trim()) return field.trim()
	}
	return fallback
}
