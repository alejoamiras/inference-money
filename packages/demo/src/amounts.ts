/** One USDC in base units (6 decimals). */
export const USDC = 1_000_000n

/**
 * The acceptance run: A_demo deposits 10 to alice, who pays galactica 10 and gets 3 refunded, is refused moving 1 to
 * bob or to B_demo, and withdraws 3 to A_demo. Net: alice 0, galactica +7, A_demo −7, the portal +7.
 */
export const SMOKE_AMOUNTS = { deposit: 10n * USDC, refund: 3n * USDC, refused: USDC, exit: 3n * USDC } as const

/** The L2 float `demo setup` seeds: alice's and bob's binding deposits (private) and galactica's (public). */
export const DEMO_SEED = { alice: 10n * USDC, bob: 2n * USDC, galactica: 10n * USDC } as const

/** What A_demo (alice's) and B_demo (bob's) are topped up to on Ethereum: together at most 0.02 ETH and 50 USDC. */
export const DEMO_L1_TARGET = {
	alice: { eth: 10n ** 16n, usdc: 40n * USDC },
	bob: { eth: 10n ** 16n, usdc: 10n * USDC },
} as const
