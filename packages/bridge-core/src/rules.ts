/**
 * The merchant token's refusals: the exact text each rule check fails with, so a client can tell which rule a
 * simulation hit. `rules.test.ts` finds every string verbatim in the Noir source, so a reworded assert fails there.
 */
export const TOKEN_REFUSALS = {
	transfer: "Transfer refused: neither sender nor recipient is a merchant",
	request: "Request refused: neither creator nor recipient is a merchant",
	payment: "Payment refused: users may only pay into requests opened for a merchant",
	notAdmin: "Only the merchant admin",
	notAdminOrGuardian: "Only the merchant admin or guardian",
	notPendingAdmin: "Only the pending merchant admin",
	noPendingChange: "No pending change",
	alreadyAdded: "Merchant already added",
	zeroMerchant: "Merchant is the zero address",
	notRegistered: "Not a registered merchant",
	delayOutOfRange: "Delay out of range",
	switchedOff: "Merchant is switched off",
} as const

export type TokenRule = keyof typeof TOKEN_REFUSALS

// Longest first: "Only the merchant admin" is a prefix of two other refusals.
const BY_LENGTH = (Object.entries(TOKEN_REFUSALS) as [TokenRule, string][]).sort(([, a], [, b]) => b.length - a.length)

/** The token rule an error's message carries (a simulation failure or a revert), or undefined. */
export function tokenRefusalOf(error: unknown): TokenRule | undefined {
	const message = error instanceof Error ? error.message : String(error)
	return BY_LENGTH.find(([, text]) => message.includes(text))?.[0]
}
