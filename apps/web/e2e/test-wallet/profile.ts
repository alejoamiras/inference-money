/**
 * The wallet shapes the suite connects the app to, each served from its own origin: the SDK's discovery probe tells
 * frames apart by origin alone, so two profiles on one origin would answer each other's probe.
 * - `main`: every actor the test seeded.
 * - `solo`: exactly one account, so the app must skip its account chooser.
 * - `late`: answers discovery only after {@link LATE_WALLET_DELAY_MS}, a slow wallet frame.
 */
export type TestWalletProfile = "main" | "solo" | "late"

export const PROFILES: readonly TestWalletProfile[] = ["main", "solo", "late"]

/** The app id the app connects under (`src/wallet/session.ts`); every other app is refused. */
export const APP_ID = "usdc-bridge"

export const LATE_WALLET_DELAY_MS = 4_000

export function parseProfile(raw: string | null): TestWalletProfile {
	if ((PROFILES as readonly (string | null)[]).includes(raw)) return raw as TestWalletProfile
	throw new Error(`test wallet: unknown profile "${raw}" (expected ${PROFILES.join(" | ")})`)
}

/** Baked into the wallet build: the local network it talks to and the one origin allowed to frame it. */
export interface TestWalletIdentity {
	nodeUrl: string
	l1ChainId: number
	rollupVersion: number
	appOrigin: string
}

/** An actor created and deployed in Node; the wallet re-imports it from exactly these. */
export interface Seed {
	secret: `0x${string}`
	signingKey: `0x${string}`
}

export const seedsFor = (profile: TestWalletProfile, seeds: readonly Seed[]): readonly Seed[] =>
	profile === "solo" ? seeds.slice(0, 1) : seeds

export const walletIdOf = (profile: TestWalletProfile) => `usdc-bridge-test-wallet-${profile}`
