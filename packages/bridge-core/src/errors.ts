function tryJsonParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

/**
 * The structured `walletErrorCode` inside a thrown wallet error, or undefined. The extension throws
 * `Error(JSON.stringify(envelope))`; the wallet-sdk iframe transport JSON-encodes that message string once more. Both
 * are decoded, never deeper.
 */
export function walletErrorCodeOf(err: unknown): string | undefined {
	const message = err instanceof Error ? err.message : typeof err === "string" ? err : undefined
	if (message === undefined) return undefined
	let parsed = tryJsonParse(message)
	if (typeof parsed === "string") parsed = tryJsonParse(parsed)
	if (!parsed || typeof parsed !== "object") return undefined
	const code = (parsed as { data?: { walletErrorCode?: unknown } }).data?.walletErrorCode
	return typeof code === "string" ? code : undefined
}

/** The part of a wallet session `retryOnUnregistered` binds to; structural so a test double satisfies it. */
export interface RetrySession<W> {
	/** The session's current wallet; replaced on reconnect. */
	current: () => W | null
	/** Re-registers the app's contracts on the current wallet; false when another flow owns it. */
	reregisterContracts: () => Promise<boolean>
}

/**
 * Runs one pre-submission wallet call; on the structured `CONTRACT_NOT_REGISTERED` code (never a text match: any
 * wallet can emit arbitrary text), re-registers the app's contracts once and runs it again. Bound to `wallet`: if the
 * session swapped wallets while `op` was in flight or before the retry, the original error propagates and nothing is
 * re-registered. A second failure propagates untouched; nothing is ever resubmitted after a broadcast.
 */
export async function retryOnUnregistered<T, W>(session: RetrySession<W>, wallet: W, op: () => Promise<T>): Promise<T> {
	try {
		return await op()
	} catch (err) {
		if (walletErrorCodeOf(err) !== "CONTRACT_NOT_REGISTERED") throw err
		if (session.current() !== wallet) throw err
		if (!(await session.reregisterContracts())) throw err
		if (session.current() !== wallet) throw err
		return await op()
	}
}

/**
 * True only for an explicit "no" from the user: EIP-1193 `4001`, viem's `UserRejectedRequestError`, or the Aztec
 * wallet's decline wordings, anywhere in the cause chain. A draft may be discarded on this alone, never on an
 * ambiguous failure (RPC outage, wallet crash).
 */
export function isUserRejection(err: unknown): boolean {
	let current: unknown = err
	for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
		const e = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }
		if (e.code === 4001 || e.name === "UserRejectedRequestError") return true
		if (typeof e.message === "string" && /rejected by user|user rejected the request|capability denied by user/i.test(e.message)) {
			return true
		}
		current = e.cause
	}
	return false
}

/** Wallet-plumbing errors in words a user can act on; anything else passes through. */
export function humanizeWalletError(message: string): string {
	if (/timed out waiting for window/i.test(message)) {
		return "The wallet's confirmation window timed out before you could sign. Reopen your wallet and retry."
	}
	return message
}
