/** One USDC in base units (6 decimals). */
export const USDC = 1_000_000n

/**
 * The acceptance run: A_demo deposits 10 to alice, who pays galactica 10 and gets 3 refunded, is refused moving 1 to
 * bob or to B_demo, and withdraws 3 to A_demo. Net: alice 0, galactica +7, A_demo −7, the portal +7.
 */
export const SMOKE_AMOUNTS = { deposit: 10n * USDC, refund: 3n * USDC, refused: USDC, exit: 3n * USDC } as const

/**
 * What `demo setup` deposits: each merchant's binding deposit from its own treasury (one unit, private), alice's and
 * bob's binding deposits (private) and galactica's float (public).
 */
export const DEMO_SEED = { merchantBind: 1n, alice: 10n * USDC, bob: 2n * USDC, galactica: 10n * USDC } as const

/** What each cast member's Ethereum account is topped up to: together at most 0.04 ETH and 50.000002 USDC. */
export const DEMO_L1_TARGET = {
	alice: { eth: 10n ** 16n, usdc: 40n * USDC },
	bob: { eth: 10n ** 16n, usdc: 10n * USDC },
	galactica: { eth: 10n ** 16n, usdc: DEMO_SEED.merchantBind },
	supplier: { eth: 10n ** 16n, usdc: DEMO_SEED.merchantBind },
} as const
