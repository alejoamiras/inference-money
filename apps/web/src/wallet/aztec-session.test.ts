/**
 * The session is driven with a push-driven discovery stream so every stream shape (0, 1, n, latecomers,
 * buffered-after-cancel) is deterministic. The SDK's real quirk (yields delivered AFTER cancel()) is emulated by a
 * cancel that does NOT close the stream: the epoch checks, not cancellation, must be the correctness boundary.
 */

import type { ChainInfo } from "@aztec/aztec.js/account"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"

vi.mock("./emoji", () => ({ hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤" }))

const mockGetAvailableWallets = vi.fn()
vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: { configure: vi.fn(() => ({ getAvailableWallets: mockGetAvailableWallets })) },
}))

import { createAztecWalletSession, missingGrants, parseAccountList, parseGrantedAccounts, parseGrantedContracts } from "./aztec-session"

type AnyProvider = Record<string, unknown>
type GrantEntry = { alias?: unknown; item?: unknown } | null

function addr(suffix: string): string {
	return `0x${suffix.padStart(64, "0")}`
}
const A = addr("aa")
const B = addr("bb")
const C = addr("cc")
const PREF_KEY = "test-app:preferred-wallet"
const SELECTED_KEY = "test-app:selected-accounts"

function makeStream() {
	const queue: AnyProvider[] = []
	const resolvers: Array<(r: IteratorResult<AnyProvider>) => void> = []
	let ended = false
	const push = (p: AnyProvider) => {
		const r = resolvers.shift()
		if (r) r({ value: p, done: false })
		else queue.push(p)
	}
	const end = () => {
		ended = true
		for (const r of resolvers.splice(0)) r({ value: undefined as never, done: true })
	}
	const wallets: AsyncIterable<AnyProvider> = {
		[Symbol.asyncIterator]() {
			return {
				next(): Promise<IteratorResult<AnyProvider>> {
					if (queue.length) return Promise.resolve({ value: queue.shift() as AnyProvider, done: false })
					if (ended) return Promise.resolve({ value: undefined as never, done: true })
					return new Promise((res) => resolvers.push(res))
				},
			}
		},
	}
	return { wallets, push, end, cancel: vi.fn() }
}

function makeProvider(opts: { id?: string; name?: string; accounts?: GrantEntry[]; granted?: unknown[] } = {}) {
	const accounts = opts.accounts ?? [{ alias: "Main", item: A }]
	const walletHandle = {
		requestCapabilities: vi.fn(async () => ({
			granted: [{ type: "accounts", canGet: true, canCreateAuthWit: true, accounts }, ...(opts.granted ?? [])],
		})),
		getAccounts: vi.fn(async () => accounts),
	}
	const pending = { verificationHash: "deadbeef", confirm: vi.fn(async () => walletHandle), cancel: vi.fn(async () => {}) }
	let disconnectHandler: (() => void) | null = null
	const provider = {
		id: opts.id ?? "acme",
		name: opts.name ?? "Acme",
		type: "extension",
		icon: undefined,
		establishSecureChannel: vi.fn(async () => pending),
		disconnect: vi.fn(async () => {}),
		onDisconnect: vi.fn((h: () => void) => {
			disconnectHandler = h
			return () => {
				disconnectHandler = null
			}
		}),
	}
	return { provider, pending, walletHandle, fireDisconnect: () => disconnectHandler?.() }
}

function makeSession(
	over: { registerContracts?: Mock<() => Promise<void>>; isSwitchBlocked?: () => boolean; buildManifest?: () => Promise<unknown> } = {},
) {
	return createAztecWalletSession({
		appId: "test-app",
		buildManifest: (over.buildManifest ?? (async () => ({}))) as () => Promise<never>,
		registerContracts: over.registerContracts ?? vi.fn(async () => {}),
		chainInfo: {} as ChainInfo,
		webWalletUrls: [],
		isSwitchBlocked: over.isSwitchBlocked,
	})
}

async function flush(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve()
}

function freshStream() {
	stream = makeStream()
	mockGetAvailableWallets.mockImplementation(() => ({ wallets: stream.wallets, cancel: stream.cancel }))
}

/** Fresh-path drive up to the emoji step (status "verifying"). */
async function driveToVerifying(s: ReturnType<typeof makeSession>, provider: AnyProvider) {
	void s.connect()
	await flush()
	stream.push(provider)
	await flush()
	s.selectWallet(s.getSnapshot().discoveredWallets[0]?.key ?? -1)
	await flush()
}

/** Fresh-path drive to the end of the capability handshake (grant applied or paused). */
async function driveThroughGrant(s: ReturnType<typeof makeSession>, provider: AnyProvider) {
	await driveToVerifying(s, provider)
	await s.confirmVerification()
}

let stream: ReturnType<typeof makeStream>

beforeEach(() => {
	localStorage.clear()
	mockGetAvailableWallets.mockReset()
	freshStream()
})
afterEach(() => {
	vi.useRealTimers()
	vi.clearAllMocks()
})

describe("discovery and flow epochs", () => {
	it("fresh path: picker opens before any answer, first arrival flips to choosing, connect persists only on success", async () => {
		const { provider } = makeProvider()
		const s = makeSession()
		const c = s.connect()
		await flush()
		expect(s.getSnapshot()).toMatchObject({ status: "discovering", pickerOpen: true, scanning: true })

		stream.push(provider)
		await flush()
		expect(s.getSnapshot().status).toBe("choosing")
		stream.end()
		await c
		expect(s.getSnapshot()).toMatchObject({ status: "choosing", scanning: false })

		s.selectWallet(s.getSnapshot().discoveredWallets[0]?.key ?? -1)
		expect(s.getSnapshot().status).toBe("verifying")
		expect(localStorage.getItem(PREF_KEY)).toBeNull()
		await flush()
		expect(s.getSnapshot().verificationEmojis).toBe("🟢🔵🟡🟣🔴⚪⚫🟠🟤")
		await s.confirmVerification()
		expect(s.getSnapshot()).toMatchObject({ status: "connected", contractsReady: true, selectedAccount: A })
		expect(s.current()).toBe(s.getSnapshot().wallet)
		expect(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}")).toEqual({ id: "acme", name: "Acme" })
	})

	it("buffered yields delivered after cancelChoice are discarded (epoch guard)", async () => {
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		await flush()
		s.cancelChoice()
		expect(s.getSnapshot()).toMatchObject({ status: "idle", error: null })
		stream.push(makeProvider({ id: "late" }).provider)
		await flush()
		expect(s.getSnapshot().discoveredWallets).toHaveLength(0)
	})

	it("a stale establish resolution is discarded and its captured pending connection cancelled", async () => {
		const { provider, pending } = makeProvider()
		let resolveEstablish: (p: typeof pending) => void = () => {}
		provider.establishSecureChannel.mockImplementation(() => new Promise<typeof pending>((res) => (resolveEstablish = res)))
		const s = makeSession()
		await driveToVerifying(s, provider)

		await s.cancelVerification()
		expect(s.getSnapshot().status).toBe("idle")
		resolveEstablish(pending)
		await flush()
		expect(pending.cancel).toHaveBeenCalled()
		expect(s.getSnapshot().verificationEmojis).toBeNull()
	})

	it("a stale confirm disconnects its CAPTURED provider and cannot release a newer flow's lock", async () => {
		const first = makeProvider({ id: "first" })
		type Handle = typeof first.walletHandle
		let resolveConfirm: (w: Handle) => void = () => {}
		first.pending.confirm.mockImplementation(() => new Promise<Handle>((res) => (resolveConfirm = res)))
		const s = makeSession()
		await driveToVerifying(s, first.provider)
		const confirming = s.confirmVerification()

		await s.disconnect()
		freshStream()
		const second = makeProvider({ id: "second", name: "Second" })
		void s.connect()
		await flush()
		stream.push(second.provider)
		await flush()
		expect(s.getSnapshot().status).toBe("choosing")

		const before = first.provider.disconnect.mock.calls.length
		resolveConfirm(first.walletHandle)
		await confirming
		expect(first.provider.disconnect.mock.calls.length).toBe(before + 1)
		expect(second.provider.disconnect).not.toHaveBeenCalled()
		expect(s.getSnapshot()).toMatchObject({ status: "choosing", wallet: null })
		expect(localStorage.getItem(PREF_KEY)).toBeNull()
	})

	it("double confirmVerification is ONE confirm (pending claimed synchronously)", async () => {
		const { provider, pending } = makeProvider()
		const s = makeSession()
		await driveToVerifying(s, provider)
		await Promise.all([s.confirmVerification(), s.confirmVerification()])
		expect(pending.confirm).toHaveBeenCalledTimes(1)
		expect(s.getSnapshot().status).toBe("connected")
	})
})

describe("remembered path (bounded ambiguity window)", () => {
	const remember = () => localStorage.setItem(PREF_KEY, JSON.stringify({ id: "acme", name: "Acme" }))

	it("a sole claimant surviving the 1 s window auto-connects: no picker, discovery cancelled", async () => {
		vi.useFakeTimers()
		remember()
		const s = makeSession()
		expect(s.getSnapshot().preferredWalletName).toBe("Acme")
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		await flush()
		expect(s.getSnapshot()).toMatchObject({ status: "discovering", pickerOpen: false })

		await vi.advanceTimersByTimeAsync(1_000)
		await flush()
		expect(s.getSnapshot()).toMatchObject({ status: "verifying", pickerOpen: false })
		expect(stream.cancel).toHaveBeenCalled()
	})

	it("a second claimant of the remembered id forces the picker and disables auto-reconnect for the session", async () => {
		vi.useFakeTimers()
		remember()
		const s = makeSession()
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		stream.push(makeProvider().provider) // impostor, or vice versa
		await flush()
		expect(s.getSnapshot()).toMatchObject({ status: "choosing", pickerOpen: true, autoReconnectDisabled: true })
		expect(s.getSnapshot().discoveredWallets).toHaveLength(2)
		expect(new Set(s.getSnapshot().discoveredWallets.map((w) => w.key)).size).toBe(2)

		await vi.advanceTimersByTimeAsync(2_000)
		expect(s.getSnapshot().status).toBe("choosing")

		s.cancelChoice()
		freshStream()
		void s.connect()
		await flush()
		stream.push(makeProvider().provider)
		await flush()
		await vi.advanceTimersByTimeAsync(1_500)
		expect(s.getSnapshot().status).toBe("choosing")
	})
})

describe("grant coverage", () => {
	const contracts = { type: "contracts", contracts: [B], canRegister: true }
	const claimScope = { type: "transaction", scope: [{ contract: B, function: "claim_private" }] }
	const buildManifest = async () => ({ capabilities: [{ type: "accounts", canGet: true }, contracts, claimScope] })

	it("a grant that registers the bridge but withholds its claim is refused before anything is set up", async () => {
		const registerContracts = vi.fn(async () => {})
		const s = makeSession({ registerContracts, buildManifest })
		await driveThroughGrant(s, makeProvider({ granted: [contracts] }).provider)
		expect(s.getSnapshot()).toMatchObject({ status: "error", contractsReady: false, error: { category: "capability-rejected" } })
		expect(registerContracts).not.toHaveBeenCalled()

		const full = makeSession({ registerContracts, buildManifest })
		freshStream()
		await driveThroughGrant(full, makeProvider({ granted: [contracts, claimScope] }).provider)
		expect(full.getSnapshot()).toMatchObject({ status: "connected", contractsReady: true, grantedContracts: [B] })
	})

	it("counts a scope on a contract the app never registers, and every requested flag, as part of the grant", () => {
		const accounts = { type: "accounts", canGet: true, canCreateAuthWit: true }
		const authwit = {
			type: "transaction",
			scope: [
				{ contract: B, function: "claim_private" },
				{ contract: A, function: "set_authorized" },
			],
		}
		const request = { capabilities: [accounts, contracts, authwit] }
		expect(missingGrants(request, { granted: [accounts, contracts, authwit] })).toEqual([])
		expect(missingGrants(request, { granted: [accounts, contracts, claimScope] }), "the auth registry's scope").toEqual([A])
		expect(missingGrants(request, { granted: [{ ...accounts, canCreateAuthWit: false }, contracts, authwit] })).toEqual([
			"accounts.canCreateAuthWit",
		])
		expect(missingGrants(request, { granted: [accounts, { ...contracts, canRegister: false }, authwit] })).toEqual([
			"contracts.canRegister",
		])
	})
})

describe("accounts: one versus many", () => {
	const two: GrantEntry[] = [
		{ alias: "Main", item: A },
		{ alias: "Savings", item: B },
	]

	it("a single granted account skips the chooser and is remembered", async () => {
		const s = makeSession()
		await driveThroughGrant(s, makeProvider().provider)
		expect(s.getSnapshot()).toMatchObject({ status: "connected", selectedAccount: A })
		expect(JSON.parse(localStorage.getItem(SELECTED_KEY) ?? "[]")).toEqual([["acme", A]])
		expect(s.consumeSelectionNotices()).toEqual([])
	})

	it("two accounts, nothing remembered: pauses in choosing-account; an outside address is refused; confirm resumes", async () => {
		const registerContracts = vi.fn(async () => {})
		const s = makeSession({ registerContracts })
		await driveThroughGrant(s, makeProvider({ accounts: two }).provider)
		expect(s.getSnapshot()).toMatchObject({ status: "choosing-account", selectedAccount: null })
		expect(registerContracts).not.toHaveBeenCalled()

		await s.confirmAccountChoice(C)
		expect(s.getSnapshot()).toMatchObject({ status: "choosing-account", selectedAccount: null })

		await s.confirmAccountChoice(B)
		expect(s.getSnapshot()).toMatchObject({ status: "connected", selectedAccount: B })
		expect(registerContracts).toHaveBeenCalledTimes(1)
		expect(JSON.parse(localStorage.getItem(SELECTED_KEY) ?? "[]")).toEqual([["acme", B]])
	})

	it("a remembered choice inside the grant auto-applies with exactly one auto-remembered notice", async () => {
		localStorage.setItem(SELECTED_KEY, JSON.stringify([["acme", B]]))
		const s = makeSession()
		await driveThroughGrant(s, makeProvider({ accounts: two }).provider)
		expect(s.getSnapshot()).toMatchObject({ status: "connected", selectedAccount: B })
		const notices = s.consumeSelectionNotices()
		expect(notices).toHaveLength(1)
		expect(notices[0]).toMatchObject({ kind: "auto-remembered", address: B, alias: "Savings" })
		expect(s.consumeSelectionNotices()).toEqual([])
	})

	it("a grant over the cap is truncated WITH a disclosed notice", async () => {
		const seventeen: GrantEntry[] = Array.from({ length: 17 }, (_, i) => ({ alias: `Acct ${i}`, item: addr((i + 1).toString(16)) }))
		const s = makeSession()
		await driveThroughGrant(s, makeProvider({ accounts: seventeen }).provider)
		expect(s.getSnapshot()).toMatchObject({ status: "choosing-account", hiddenAccountsCount: 1 })
		expect(s.getSnapshot().accounts).toHaveLength(16)
		expect(s.getSnapshot().selectionNotices).toEqual([expect.objectContaining({ kind: "grant-truncated", hiddenCount: 1 })])
	})
})

describe("flow ownership", () => {
	it("retryCapabilities is a no-op while the initial capability request owns the flow", async () => {
		const { provider, walletHandle } = makeProvider()
		type Caps = Awaited<ReturnType<typeof walletHandle.requestCapabilities>>
		let resolveCaps: (v: Caps) => void = () => {}
		walletHandle.requestCapabilities.mockImplementation(() => new Promise<Caps>((res) => (resolveCaps = res)))
		const s = makeSession()
		await driveToVerifying(s, provider)
		const confirming = s.confirmVerification()
		await flush()
		expect(s.getSnapshot().status).toBe("capability-approval")

		await expect(s.retryCapabilities()).resolves.toBe(false)
		expect(walletHandle.requestCapabilities).toHaveBeenCalledTimes(1)

		resolveCaps({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: A }] }] })
		await confirming
		expect(s.getSnapshot().status).toBe("connected")
	})

	it("reregisterContracts: false while a flow owns the wallet, true once connected, false (no error) when a disconnect lands mid-flight", async () => {
		const releases: Array<() => void> = []
		const registerContracts = vi.fn(() => new Promise<void>((res) => releases.push(res)))
		const { provider, fireDisconnect } = makeProvider()
		const s = makeSession({ registerContracts })
		await driveToVerifying(s, provider)
		const confirming = s.confirmVerification()
		await flush()
		expect(s.getSnapshot().status).toBe("setting-up")
		await expect(s.reregisterContracts()).resolves.toBe(false)
		releases.shift()?.()
		await confirming
		expect(s.getSnapshot()).toMatchObject({ status: "connected", contractsReady: true })

		const pending = s.reregisterContracts()
		await flush()
		expect(s.getSnapshot().contractsReady).toBe(false)
		fireDisconnect()
		releases.shift()?.()
		await expect(pending).resolves.toBe(false)
		expect(s.getSnapshot()).toMatchObject({ status: "idle", error: null, contractsReady: false })
		expect(registerContracts).toHaveBeenCalledTimes(2)
	})
})

describe("snapshot", () => {
	it("keeps the same frozen object until a change, then a new one; subscribers fire synchronously", async () => {
		const s = makeSession()
		const listener = vi.fn()
		s.subscribe(listener)
		const a = s.getSnapshot()
		expect(Object.isFrozen(a)).toBe(true)
		expect(s.getSnapshot()).toBe(a)

		void s.connect()
		await flush()
		const b = s.getSnapshot()
		expect(b).not.toBe(a)
		expect(b.status).toBe("discovering")
		expect(s.getSnapshot()).toBe(b)
		expect(listener).toHaveBeenCalled()

		s.cancelChoice()
		expect(s.getSnapshot().status).toBe("idle")
	})
})

describe("parseGrantedAccounts / parseAccountList", () => {
	it("skips malformed, short, overflow and throwing entries; dedupes by canonical address (first wins)", () => {
		const upper = A.toUpperCase().replace("0X", "0x")
		const { accounts, hiddenCount } = parseGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "first", item: upper },
						{ alias: "dup", item: A },
						{ alias: "short", item: "0xa1" },
						{ alias: "junk", item: "0xzz" },
						{ alias: "overflow", item: `0x${"ff".repeat(32)}` },
						{
							alias: "thrower",
							item: {
								toString: () => {
									throw new Error("boom")
								},
							},
						},
						null,
						{ alias: "no-item" },
					],
				},
			],
		})
		expect(accounts).toEqual([{ address: A, alias: "first" }])
		expect(hiddenCount).toBe(0)
		expect(parseGrantedAccounts({ granted: "nope" })).toEqual({ accounts: [], hiddenCount: 0 })
	})

	it("sanitizes aliases: control/bidi stripped, whitespace trimmed, length capped, non-strings emptied", () => {
		const { accounts } = parseGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "Sav‮ings⁦\u0000", item: A },
						{ alias: `  ${"x".repeat(60)}  `, item: B },
						{ alias: 42, item: C },
					],
				},
			],
		})
		expect(accounts.map((a) => a.alias)).toEqual(["Savings", `${"x".repeat(48)}…`, ""])
	})

	it("caps the list at 16 with a hidden count; `keep` retains the selected account past the cap", () => {
		const many = Array.from({ length: 18 }, (_, i) => ({ alias: `a${i}`, item: addr(i.toString(16).padStart(2, "0")) }))
		const capped = parseAccountList(many)
		expect(capped.accounts).toHaveLength(16)
		expect(capped.hiddenCount).toBe(2)

		const last = many[17]?.item as string
		const kept = parseAccountList(many, { keep: last })
		expect(kept.accounts).toHaveLength(16)
		expect(kept.hiddenCount).toBe(2)
		expect(kept.accounts.map((a) => a.address)).toContain(last)
		expect(parseAccountList(null)).toEqual({ accounts: [], hiddenCount: 0 })
	})
})

describe("parseGrantedContracts", () => {
	/** B carries a transaction AND a simulation scope, C carries none. */
	const REQUEST = {
		capabilities: [
			{ type: "accounts", canGet: true },
			{ type: "contracts", contracts: [B, C], canRegister: true },
			{ type: "transaction", scope: [{ contract: B, function: "burn_public" }] },
			{ type: "simulation", utilities: { scope: [{ contract: B, function: "balance_of_private" }] } },
		],
	}
	const FULL_ANSWER = { granted: REQUEST.capabilities }

	it("intersects the request with the answer, lowercased and in request order, ignoring unrequested contracts", () => {
		const upper = B.toUpperCase().replace("0X", "0x")
		const answer = { granted: [{ type: "contracts", contracts: [A, upper, C] }, ...REQUEST.capabilities.slice(2)] }
		expect(parseGrantedContracts(REQUEST, answer)).toEqual([B, C])
		expect(parseGrantedContracts(REQUEST, FULL_ANSWER)).toEqual([B, C])
	})

	it("refuses a contract whose requested transaction or simulation scope did not come back", () => {
		expect(parseGrantedContracts(REQUEST, { granted: [REQUEST.capabilities[1], REQUEST.capabilities[3]] })).toEqual([C])
		expect(parseGrantedContracts(REQUEST, { granted: [REQUEST.capabilities[1], REQUEST.capabilities[2]] })).toEqual([C])
	})

	it("yields nothing for a wildcard on either side, a missing capability, or a malformed source", () => {
		const wildcardContracts = { granted: [{ type: "contracts", contracts: "*" }, ...REQUEST.capabilities.slice(2)] }
		expect(parseGrantedContracts(REQUEST, wildcardContracts)).toEqual([])
		const wildcardFunction = {
			granted: [REQUEST.capabilities[1], { type: "transaction", scope: [{ contract: B, function: "*" }] }, REQUEST.capabilities[3]],
		}
		expect(parseGrantedContracts(REQUEST, wildcardFunction)).toEqual([])
		expect(parseGrantedContracts({ capabilities: [{ type: "transaction", scope: "*" }] }, FULL_ANSWER)).toEqual([])
		expect(parseGrantedContracts(REQUEST, { granted: [{ type: "accounts", accounts: [] }] })).toEqual([])
		expect(parseGrantedContracts(REQUEST, null)).toEqual([])
		expect(parseGrantedContracts(null, FULL_ANSWER)).toEqual([])
		const request = { capabilities: [{ type: "contracts", contracts: ["0xa1", "not-an-address", null, B] }] }
		expect(parseGrantedContracts(request, { granted: [{ type: "contracts", contracts: [B] }] })).toEqual([B])
	})
})
