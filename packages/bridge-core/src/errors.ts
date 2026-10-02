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
