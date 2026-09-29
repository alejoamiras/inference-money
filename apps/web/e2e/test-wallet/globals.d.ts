import type { Seed, TestWalletIdentity, TestWalletProfile } from "./profile"
import type { SubmittedTx } from "./wallet"

/** The suite's control surface, reached through the wallet frame. */
export interface TestWalletControl {
	profile: TestWalletProfile
	ready: () => Promise<void>
	accounts: () => Promise<string[]>
	/** How many times the app called each wallet method since this frame loaded, denied and faulted calls included. */
	calls: () => Record<string, number>
	/** Every call refused for falling outside the grant, as `<what> of <contract>.<function>`. */
	denied: () => string[]
	submitted: () => Promise<SubmittedTx[]>
	failNext: (method: string, pattern?: string, message?: string) => void
	holdNext: (method: string, pattern?: string) => void
	swallowNext: (method: string, pattern?: string) => void
	/** Runs every held call now; how many there were. */
	release: () => number
	dropNextSubmission: () => Promise<void>
	declineNextGrant: () => Promise<void>
}

declare global {
	/** Baked by the wallet's vite config from the run's manifest. */
	const __TEST_WALLET__: TestWalletIdentity
	interface Window {
		__testWallet?: TestWalletControl
		/** Set by the suite's init script, in wallet origins only, before any page script runs. */
		__testWalletSeeds?: Seed[]
	}
}
