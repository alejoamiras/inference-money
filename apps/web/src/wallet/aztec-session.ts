import type { ChainInfo } from "@aztec/aztec.js/account"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import type { PendingConnection, WalletProvider } from "@aztec/wallet-sdk/manager"
import { WalletManager } from "@aztec/wallet-sdk/manager"
import { createStore } from "./cell"
import { hashToEmoji } from "./emoji"
import { type NormalizedError, normalizeError } from "./errors"
import { enqueuePrompt } from "./prompt-queue"

export type ConnectStatus =
	| "idle"
	| "discovering"
	| "choosing"
	| "verifying"
	| "capability-approval"
	| "choosing-account"
	| "setting-up"
	| "connected"
	| "error"

export interface GrantedAccount {
	readonly address: string
	readonly alias: string
}

/** One-shot UI notification from the selection logic, drained exactly once by a single UI owner via
 *  `consumeSelectionNotices` — never inferred from status changes. */
export interface SelectionNotice {
	/** Monotonic per-session key, so the consumer can prove exactly-once handling. */
	readonly key: number
	readonly kind: "auto-remembered" | "grant-truncated"
	readonly alias?: string
	readonly address?: string
	readonly hiddenCount?: number
}

/**
 * A plain-data projection of a discovery announcement. `key` is an opaque per-announcement counter, NOT the
 * provider's claimed `id`: any wallet can claim any id/name/icon, so claimed-id collisions render as separate rows
 * instead of deduping the impostor (or the real wallet) away.
 */
export interface DiscoveredWallet {
	readonly key: number
	readonly id: string
	readonly name: string
	readonly type: string
	readonly icon?: string
}

/** Remembered choice: id selects the auto-reconnect candidate, name feeds the idle-state label. */
interface PreferredWallet {
	readonly id: string
	readonly name: string
}

export type RefreshOutcome = "refreshed" | "skipped" | "dropped"

/** How long the remembered path waits for a second claimant of the stored id before auto-connecting. Best-effort
 *  collision detection only; the emoji verification remains the trust anchor. */
const REMEMBERED_AMBIGUITY_WINDOW_MS = 1_000

/** The stored name is rendered in the idle hint, so it is capped at WRITE time: a multi-megabyte claimed name must
 *  not defeat the picker's render capping. */
const PREFERRED_NAME_MAX = 48
/** Wallet-claimed aliases are capped at parse time, same rationale as PREFERRED_NAME_MAX. */
const ALIAS_MAX = 48
/** Granted-list bound. Truncation is DISCLOSED via a SelectionNotice, never silent: a hidden account 17 would be the
 *  hidden-account bug the disclosure exists to prevent. */
const MAX_GRANTED_ACCOUNTS = 16
/** Same bound for the granted contract list: wallet-controlled input, and the app only asks for a set it can enumerate. */
const MAX_GRANTED_CONTRACTS = 256
/** Per-wallet selected-account memory, most-recent-first, so A→B→A keeps both. */
const MAX_REMEMBERED_WALLETS = 8
/** Bound on stored id/address strings: storage is untrusted input. */
const STORED_STRING_MAX = 256
/** Control chars + bidi override/isolate marks: a wallet-claimed alias must not reorder or hide adjacent UI text. The
 *  address is always rendered beside the alias as the unambiguous identity. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
const UNSAFE_ALIAS_CHARS = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁦-⁩﻿]/g

/** Code-point-safe bounded truncation: a UTF-16 `slice` can split an emoji surrogate pair in a claimed name. */
export function truncateName(name: string, max: number): string {
	const points = Array.from(name)
	return points.length > max ? `${points.slice(0, max).join("")}…` : name
}

/**
 * Per-app config for an Aztec wallet session: one session, one grant, one active account.
 *
 * Account-selection contract for consumers: read `selectedAccount` AT ACTION TIME and capture it for the operation's
 * lifetime; hold the switch gate (`isSwitchBlocked`) for every account-sensitive prompt/send span.
 */
export interface AztecWalletSessionConfig {
	readonly appId: string
	/** Build the wallet-sdk capability manifest at connect time (async: it needs the fee payer). */
	readonly buildManifest: () => Promise<unknown>
	/** Register the app's contracts with the wallet's PXE after capabilities are granted. */
	readonly registerContracts: (wallet: Wallet) => Promise<void>
	readonly chainInfo: ChainInfo
	/** Iframe wallet URLs; empty on every shipped target, so the iframe transport is never probed there. */
	readonly webWalletUrls: readonly string[]
	/** Mutation-boundary guard for account switching: while it returns true, `selectAccount()` rejects. Injected so the
	 *  factory stays UI-agnostic and the gate is unit-testable. */
	readonly isSwitchBlocked?: () => boolean
}

/** A frozen projection of the session's reactive state; the same object until something changes. */
export interface AztecSessionSnapshot {
	readonly status: ConnectStatus
	readonly verificationEmojis: string | null
	readonly accounts: readonly GrantedAccount[]
	/** The contracts the app may act on, lowercased: the requested manifest INTERSECTED with the wallet's answer,
	 *  scopes included. */
	readonly grantedContracts: readonly string[]
	readonly selectedAccount: string | null
	readonly selectionNotices: readonly SelectionNotice[]
	/** Valid accounts dropped by the grant cap: drives the persistent "Showing N of M" disclosure. */
	readonly hiddenAccountsCount: number
	/** True only while the app's contracts are registered with the connected wallet's PXE; a send issued before it is
	 *  true would fail on an unregistered contract, so the send gates read it. */
	readonly contractsReady: boolean
	readonly error: NormalizedError | null
	readonly wallet: Wallet | null
	readonly discoveredWallets: readonly DiscoveredWallet[]
	/** True while the discovery stream is live. */
	readonly scanning: boolean
	/** Opened IMMEDIATELY on a fresh connect, before any wallet answers: a wallet's discovery-approval prompt can gate
	 *  the first announcement, and the user must see the scan happening. The remembered path keeps it closed unless it
	 *  falls back to a choice. */
	readonly pickerOpen: boolean
	readonly preferredWalletName: string | null
	/** Set once two announcements claim the remembered id; stays set until reload, since re-running discovery cannot
	 *  un-ambiguate a spoofed identity. */
	readonly autoReconnectDisabled: boolean
}

/** The controllers `createAztecWalletSession` returns. */
export type AztecWalletSession = ReturnType<typeof createAztecWalletSession>

/**
 * Create an Aztec wallet session: discover → choose (picker) → verify (emoji match) → request capabilities → register
 * contracts → connected. Call ONCE per app at module scope.
 *
 * Concurrency model: a single flow epoch. Every async continuation captures the epoch AND the handles
 * (provider/pending/wallet) it operates on; cancel/disconnect/dismiss bump the epoch and wipe state SYNCHRONOUSLY
 * before any awaited SDK teardown, so a newer flow can never be clobbered by an older one's cleanup. A stale
 * continuation discards its result AND undoes its own SDK side effects via its CAPTURED handles, never the mutable
 * session fields (those may already belong to a newer flow). Nothing is module-global: two sessions never share a flow.
 */
export function createAztecWalletSession(config: AztecWalletSessionConfig) {
	const s = createSessionState(config)
	let snapshot: AztecSessionSnapshot | null = null
	let snapshotVersion = -1
	return {
		subscribe: (listener: () => void): (() => void) => s.store.subscribe(listener),
		getSnapshot: (): AztecSessionSnapshot => {
			if (snapshot === null || snapshotVersion !== s.store.version()) {
				snapshotVersion = s.store.version()
				snapshot = takeSnapshot(s)
			}
			return snapshot
		},
		current: (): Wallet | null => s.wallet.value,
		connect: (): Promise<void> => connectImpl(s, false),
		/** A fresh scan that goes straight to the picker, IGNORING the remembered wallet for this flow only. The stored
		 *  preference survives a cancel and is overwritten by whichever wallet next connects. */
		connectWithPicker: (): Promise<void> => connectImpl(s, true),
		selectWallet: (key: number): void => selectWallet(s, key),
		cancelChoice: (): void => cancelChoice(s),
		forgetPreferredWallet: (): void => clearPreferred(s),
		switchWallet: (): Promise<void> => switchWallet(s),
		confirmVerification: (): Promise<void> => confirmVerification(s),
		cancelVerification: (): Promise<void> => cancelVerification(s),
		confirmAccountChoice: (address: string): Promise<void> => confirmAccountChoice(s, address),
		cancelAccountChoice: (): Promise<void> => cancelAccountChoice(s),
		selectAccount: (address: string): boolean => selectAccount(s, address),
		consumeSelectionNotices: (): SelectionNotice[] => consumeSelectionNotices(s),
		/** False when it did not run because another flow already owns the wallet, not a refusal. */
		retryCapabilities: (): Promise<boolean> => retryCapabilities(s),
		/** Quietly re-register the app's contracts on the current wallet. False when a flow owns the wallet or the session
		 *  went stale mid-flight; rethrows a genuine registration failure after publishing it. */
		reregisterContracts: (): Promise<boolean> => reregisterContracts(s),
		/** Re-read the session's accounts from the wallet (no prompt); see `refreshAccounts`. */
		refreshAccounts: (): Promise<RefreshOutcome> => enqueuePrompt(() => refreshAccounts(s)),
		disconnect: (): Promise<void> => disconnect(s),
		reset: (): void => reset(s),
	}
}

function takeSnapshot(s: SessionState): AztecSessionSnapshot {
	return Object.freeze({
		status: s.status.value,
		verificationEmojis: s.verificationEmojis.value,
		accounts: s.accounts.value,
		grantedContracts: s.grantedContracts.value,
		selectedAccount: s.selectedAccount.value,
		selectionNotices: s.selectionNotices.value,
		hiddenAccountsCount: s.hiddenAccountsCount.value,
		contractsReady: s.contractsReady.value,
		error: s.error.value,
		wallet: s.wallet.value,
		discoveredWallets: s.discoveredWallets.value,
		scanning: s.scanning.value,
		pickerOpen: s.pickerOpen.value,
		preferredWalletName: s.preferredWalletName.value,
		autoReconnectDisabled: s.autoReconnectDisabled.value,
	})
}

/** Single-use pause token for the choose-account step. Like the verification step's `pending`, it is CLAIMED
 *  synchronously (nulled before any await) by whichever continuation runs first, so double-confirm, confirm-vs-cancel
 *  and racing panels collapse to one winner. Captures the flow's own handles so stale cleanup never dereferences the
 *  mutable session fields. */
interface PendingAccountChoice {
	flowEpoch: number
	wallet: Wallet
	provider: WalletProvider | null
}

/** One object per session: the reactive cells plus the mutable flow fields the controllers share. */
function createSessionState(config: AztecWalletSessionConfig) {
	const store = createStore()
	const storageKey = `${config.appId}:preferred-wallet`
	const selectedStorageKey = `${config.appId}:selected-accounts`
	return {
		config,
		store,
		storageKey,
		selectedStorageKey,
		status: store.cell<ConnectStatus>("idle"),
		verificationEmojis: store.cell<string | null>(null),
		accounts: store.cell<readonly GrantedAccount[]>([]),
		grantedContracts: store.cell<readonly string[]>([]),
		selectedAccount: store.cell<string | null>(null),
		contractsReady: store.cell(false),
		hiddenAccountsCount: store.cell(0),
		error: store.cell<NormalizedError | null>(null),
		wallet: store.cell<Wallet | null>(null),
		discoveredWallets: store.cell<readonly DiscoveredWallet[]>([]),
		scanning: store.cell(false),
		pickerOpen: store.cell(false),
		preferredWalletName: store.cell<string | null>(readPreferredFor(storageKey)?.name ?? null),
		autoReconnectDisabled: store.cell(false),
		selectionNotices: store.cell<readonly SelectionNotice[]>([]),
		provider: null as WalletProvider | null,
		pending: null as PendingConnection | null,
		cancelDiscovery: null as (() => void) | null,
		unsubscribeDisconnect: null as (() => void) | null,
		pendingAccountChoice: null as PendingAccountChoice | null,
		nextNoticeKey: 0,
		// Provider objects carry methods + a MessagePort: they never enter reactive state.
		providersByKey: new Map<number, WalletProvider>(),
		nextKey: 0,
		// `activeFlowEpoch` is the epoch that OWNS the in-flight flow: a stale flow's cleanup releases the lock only if it
		// still owns it, so it can never free a newer flow's.
		epoch: 0,
		activeFlowEpoch: null as number | null,
		// True while the in-flight connect chain was entered via the remembered path: its failures clear the stored
		// preference so one bad auto-path cannot lock the user out of the picker.
		connectingViaRemembered: false,
		ambiguityTimer: null as ReturnType<typeof setTimeout> | null,
	}
}

type SessionState = ReturnType<typeof createSessionState>

// ---------------------------------------------------------------------------------------------
// Storage controller: localStorage is untrusted input; every read re-validates and bounds.
// ---------------------------------------------------------------------------------------------

function readPreferredFor(storageKey: string): PreferredWallet | null {
	try {
		const raw = localStorage.getItem(storageKey)
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		if (typeof parsed !== "object" || parsed === null) return null
		const { id, name } = parsed as { id?: unknown; name?: unknown }
		if (typeof id !== "string" || typeof name !== "string") return null
		return { id, name: truncateName(name.replace(UNSAFE_ALIAS_CHARS, "").trim(), PREFERRED_NAME_MAX) }
	} catch {
		return null
	}
}
function writePreferred(s: SessionState, value: PreferredWallet): void {
	// Bounded on write as well as read: a hostile provider id must not produce oversized writes.
	if (value.id.length === 0 || value.id.length > STORED_STRING_MAX) return
	const capped = { id: value.id, name: truncateName(value.name, PREFERRED_NAME_MAX) }
	try {
		localStorage.setItem(s.storageKey, JSON.stringify(capped))
	} catch {
		// A throwing storage must never affect an established session.
	}
	s.preferredWalletName.value = capped.name
}
function clearPreferred(s: SessionState): void {
	try {
		localStorage.removeItem(s.storageKey)
	} catch {
		// best-effort
	}
	s.preferredWalletName.value = null
}

/** Per-wallet selected-account memory: `[walletId, address][]`, most-recent-first. The read path re-validates shape,
 *  bounds every string, dedupes ids and re-caps the list; content only ever PRE-SELECTS among the live grant, never
 *  selects an outside address (the lookup sites validate against the grant). */
function readRememberedMap(s: SessionState): Array<[string, string]> {
	try {
		const raw = localStorage.getItem(s.selectedStorageKey)
		if (!raw) return []
		return parseRememberedEntries(JSON.parse(raw))
	} catch {
		return []
	}
}
function parseRememberedEntries(parsed: unknown): Array<[string, string]> {
	if (!Array.isArray(parsed)) return []
	const out: Array<[string, string]> = []
	for (const entry of parsed) {
		const pair = rememberedEntryOf(entry)
		if (pair === null) continue
		if (out.some(([seenId]) => seenId === pair[0])) continue
		out.push(pair)
		if (out.length >= MAX_REMEMBERED_WALLETS) break
	}
	return out
}
function rememberedEntryOf(entry: unknown): [string, string] | null {
	if (!Array.isArray(entry) || entry.length !== 2) return null
	const [id, address] = entry as [unknown, unknown]
	if (typeof id !== "string" || typeof address !== "string") return null
	if (id.length === 0 || id.length > STORED_STRING_MAX || address.length === 0 || address.length > STORED_STRING_MAX) return null
	return [id, address]
}
function readRememberedAccount(s: SessionState, walletId: string): string | null {
	return readRememberedMap(s).find(([id]) => id === walletId)?.[1] ?? null
}
function writeRememberedAccount(s: SessionState, walletId: string, address: string): void {
	if (walletId.length === 0 || walletId.length > STORED_STRING_MAX || address.length > STORED_STRING_MAX) return
	// Atomic rebuild: filter-out + unshift + cap, then ONE setItem.
	const head: [string, string] = [walletId, address]
	const next = [head, ...readRememberedMap(s).filter(([id]) => id !== walletId)].slice(0, MAX_REMEMBERED_WALLETS)
	try {
		localStorage.setItem(s.selectedStorageKey, JSON.stringify(next))
	} catch {
		// A throwing storage must never affect an established session.
	}
}

/** Set the active account and remember it for this wallet. Persisted AT selection time, before setup, so a setup
 *  failure + retry re-applies it without re-prompting. */
function applySelection(s: SessionState, address: string, flowProvider: WalletProvider | null): void {
	s.selectedAccount.value = address
	if (flowProvider) writeRememberedAccount(s, flowProvider.id, address)
}

// ---------------------------------------------------------------------------------------------
// Flow-ownership controller: epoch checks, synchronous wipes, best-effort SDK teardown.
// ---------------------------------------------------------------------------------------------

function pushSelectionNotice(s: SessionState, notice: Omit<SelectionNotice, "key">): void {
	s.selectionNotices.value = [...s.selectionNotices.value, { ...notice, key: s.nextNoticeKey++ }]
}
/** Drain pending notices exactly once. */
function consumeSelectionNotices(s: SessionState): SelectionNotice[] {
	const drained = [...s.selectionNotices.value]
	if (drained.length > 0) s.selectionNotices.value = []
	return drained
}

function isStale(s: SessionState, flowEpoch: number): boolean {
	return flowEpoch !== s.epoch
}
function releaseFlowIfOwner(s: SessionState, flowEpoch: number): void {
	if (s.activeFlowEpoch === flowEpoch) s.activeFlowEpoch = null
}
function clearAmbiguityTimer(s: SessionState): void {
	if (s.ambiguityTimer !== null) {
		clearTimeout(s.ambiguityTimer)
		s.ambiguityTimer = null
	}
}
function stopDiscovery(s: SessionState): void {
	try {
		s.cancelDiscovery?.()
	} catch {
		// best-effort
	}
	s.cancelDiscovery = null
	s.scanning.value = false
}
function claimantsOf(s: SessionState, id: string): DiscoveredWallet[] {
	return s.discoveredWallets.value.filter((w) => w.id === id)
}

/** Synchronous state wipe + terminal transition. SDK teardown of CAPTURED handles happens AFTER this, so an
 *  overlapping newer flow is never clobbered by an older teardown's awaits. */
function wipeToIdle(s: SessionState): void {
	s.epoch++
	clearAmbiguityTimer(s)
	stopDiscovery(s)
	cleanupSession(s)
	s.status.value = "idle"
	s.error.value = null
	s.activeFlowEpoch = null
	s.contractsReady.value = false
}

function cleanupSession(s: SessionState): void {
	if (s.unsubscribeDisconnect) {
		try {
			s.unsubscribeDisconnect()
		} catch {
			// best-effort
		}
		s.unsubscribeDisconnect = null
	}
	clearAmbiguityTimer(s)
	s.provider = null
	s.pending = null
	s.cancelDiscovery = null
	s.scanning.value = false
	s.pickerOpen.value = false
	s.providersByKey.clear()
	s.discoveredWallets.value = []
	s.connectingViaRemembered = false
	s.wallet.value = null
	s.accounts.value = []
	s.grantedContracts.value = []
	s.selectedAccount.value = null
	s.verificationEmojis.value = null
	s.pendingAccountChoice = null
	s.selectionNotices.value = []
	s.hiddenAccountsCount.value = 0
}

/** A flow that went stale AFTER the wallet-side session came to exist (post-confirm, or mid-setup) leaves a live
 *  session behind: disconnect it, best-effort. */
async function disconnectStaleSession(flowProvider: WalletProvider | null): Promise<void> {
	try {
		await flowProvider?.disconnect()
	} catch {
		// best-effort
	}
}

// ---------------------------------------------------------------------------------------------
// Discovery controller: scan, remembered auto-path, picker.
// ---------------------------------------------------------------------------------------------

/** Remembered-window fire: a sole claimant of the remembered id auto-connects; otherwise the picker shows, so
 *  non-claimant wallets never sit hidden for the full 60 s discovery timeout. */
function fireRememberedWindow(s: SessionState, preferredId: string, flowEpoch: number): void {
	s.ambiguityTimer = null
	if (isStale(s, flowEpoch) || s.status.value !== "discovering") return
	const claimants = claimantsOf(s, preferredId)
	const sole = claimants.length === 1 ? claimants[0] : undefined
	if (sole) {
		s.connectingViaRemembered = true
		void proceedWith(s, sole.key, flowEpoch)
	} else if (s.discoveredWallets.value.length > 0) {
		s.status.value = "choosing"
		s.pickerOpen.value = true
	}
}

async function connectImpl(s: SessionState, forcePicker: boolean): Promise<void> {
	if (s.activeFlowEpoch !== null || s.status.value === "connected") return
	sweepErroredResidue(s)
	const { flowEpoch, preferred } = openFlow(s, forcePicker)

	try {
		const { webWalletUrls } = s.config
		const manager = WalletManager.configure({
			extensions: { enabled: true },
			...(webWalletUrls.length > 0 ? { webWallets: { urls: [...webWalletUrls] } } : {}),
		})
		const discovery = manager.getAvailableWallets({ chainInfo: s.config.chainInfo, appId: s.config.appId, timeout: 60_000 })
		s.cancelDiscovery = discovery.cancel

		for await (const p of discovery.wallets) {
			// The SDK buffers yields past cancel(): the epoch check, not cancellation, keeps a dismissed/superseded flow
			// from repopulating state. The status check stops the SAME flow's buffered stragglers once a wallet has been
			// selected (verifying and beyond must not grow the list).
			if (isStale(s, flowEpoch) || (s.status.value !== "discovering" && s.status.value !== "choosing")) return
			admitAnnouncement(s, p, preferred, flowEpoch)
		}

		// Natural end of the stream (timeout/exhaustion), not a cancel (that returns above).
		const end = settleDiscoveryEnd(s, preferred, flowEpoch)
		if (end.kind === "proceed") {
			await proceedWith(s, end.key, flowEpoch)
			return
		}
		if (end.kind === "no-wallet") throw new Error("No wallet discovered")
	} catch (err) {
		if (isStale(s, flowEpoch)) return
		s.error.value = normalizeError(err)
		s.status.value = "error"
		cleanupSession(s)
		releaseFlowIfOwner(s, flowEpoch)
	}
}

/** Sweep any residue from a previous ERRORED flow (retained provider/wallet/subscription): wipe synchronously, then
 *  best-effort disconnect the captured handle. Otherwise a retry's discovery runs over a live wallet session whose
 *  stale onDisconnect could later tear down the replacement. */
function sweepErroredResidue(s: SessionState): void {
	const staleProvider = s.provider
	if (s.provider || s.wallet.value || s.pending) {
		cleanupSession(s)
		if (staleProvider) {
			void staleProvider.disconnect().catch(() => {})
		}
	}
}

/** Claim a fresh flow epoch and reset the discovery state for it. */
function openFlow(s: SessionState, forcePicker: boolean): { flowEpoch: number; preferred: PreferredWallet | null } {
	const flowEpoch = ++s.epoch
	s.activeFlowEpoch = flowEpoch

	s.error.value = null
	s.connectingViaRemembered = false
	s.discoveredWallets.value = []
	s.providersByKey.clear()
	s.status.value = "discovering"
	s.scanning.value = true

	const preferred = forcePicker || s.autoReconnectDisabled.value ? null : readPreferredFor(s.storageKey)
	s.pickerOpen.value = preferred === null
	return { flowEpoch, preferred }
}

/** One announcement: register the provider row, then either arm/collapse the remembered window (preferred path) or
 *  open the picker (fresh path). Synchronous. */
function admitAnnouncement(s: SessionState, p: WalletProvider, preferred: PreferredWallet | null, flowEpoch: number): void {
	const row: DiscoveredWallet = { key: s.nextKey++, id: p.id, name: p.name, type: p.type, icon: p.icon }
	s.providersByKey.set(row.key, p)
	s.discoveredWallets.value = [...s.discoveredWallets.value, row]

	if (preferred) {
		const claimants = claimantsOf(s, preferred.id)
		if (claimants.length >= 2) {
			// A second claimant to the remembered identity: fail closed. Kill the window, disable auto-reconnect for the
			// session, force the picker.
			clearAmbiguityTimer(s)
			s.autoReconnectDisabled.value = true
			if (s.status.value === "discovering") s.status.value = "choosing"
			s.pickerOpen.value = true
		} else if (s.ambiguityTimer === null && s.status.value === "discovering") {
			// The FIRST announcement (claimant or not) opens the bounded window. Discovery stays LIVE during it so
			// buffered and late announcements are seen.
			s.ambiguityTimer = setTimeout(() => fireRememberedWindow(s, preferred.id, flowEpoch), REMEMBERED_AMBIGUITY_WINDOW_MS)
		}
	} else if (s.status.value === "discovering") {
		s.status.value = "choosing"
	}
}

type DiscoveryEnd = { kind: "stale" } | { kind: "done" } | { kind: "proceed"; key: number } | { kind: "choosing" } | { kind: "no-wallet" }

/** Natural end of the discovery stream, classified synchronously (its own side effects applied): `proceed` hands the
 *  caller the sole remembered claimant to bind, `no-wallet` tells it to throw, `choosing` opened the picker, `done`
 *  means a selection already moved the flow on. */
function settleDiscoveryEnd(s: SessionState, preferred: PreferredWallet | null, flowEpoch: number): DiscoveryEnd {
	if (isStale(s, flowEpoch)) return { kind: "stale" }
	s.cancelDiscovery = null
	s.scanning.value = false
	clearAmbiguityTimer(s)

	if (s.status.value !== "discovering") return { kind: "done" }
	// Still no transition: either zero announcements, or the window had not fired yet. Resolve now.
	const claimants = preferred ? claimantsOf(s, preferred.id) : []
	const sole = claimants.length === 1 ? claimants[0] : undefined
	if (sole) {
		s.connectingViaRemembered = true
		return { kind: "proceed", key: sole.key }
	}
	if (s.discoveredWallets.value.length > 0) {
		s.status.value = "choosing"
		s.pickerOpen.value = true
		return { kind: "choosing" }
	}
	return { kind: "no-wallet" }
}

/** User picks a row. Transitions SYNCHRONOUSLY so a double click (or a second panel's click, or a racing
 *  remembered-window timer) is a no-op. */
function selectWallet(s: SessionState, key: number): void {
	if (s.status.value !== "choosing" && s.status.value !== "discovering") return
	const flowEpoch = s.epoch
	clearAmbiguityTimer(s)
	s.connectingViaRemembered = false
	s.status.value = "verifying"
	s.pickerOpen.value = false
	void proceedWith(s, key, flowEpoch)
}

/** Shared tail of the remembered auto-path and manual selection: bind to ONE provider and open the secure channel. */
async function proceedWith(s: SessionState, key: number, flowEpoch: number): Promise<void> {
	const chosen = s.providersByKey.get(key)
	if (!chosen) {
		s.error.value = normalizeError(new Error("No wallet discovered"))
		s.status.value = "error"
		cleanupSession(s)
		releaseFlowIfOwner(s, flowEpoch)
		return
	}
	stopDiscovery(s)
	s.status.value = "verifying"
	s.pickerOpen.value = false
	s.provider = chosen

	try {
		const p = await chosen.establishSecureChannel(s.config.appId)
		if (isStale(s, flowEpoch)) {
			// Stale resolution: discard AND undo the SDK side effect on the CAPTURED handle.
			try {
				await p.cancel()
			} catch {
				// best-effort
			}
			return
		}
		s.pending = p
		s.verificationEmojis.value = hashToEmoji(p.verificationHash)
	} catch (err) {
		if (isStale(s, flowEpoch)) return
		// A stale announcement (extension reloaded between announce and pick) fails here: discard every provider object,
		// none is re-usable, and surface a retryable error.
		if (s.connectingViaRemembered) clearPreferred(s)
		s.error.value = normalizeError(err)
		s.status.value = "error"
		cleanupSession(s)
		releaseFlowIfOwner(s, flowEpoch)
	}
}

/** Dismiss the picker: back to idle. An intentional cancel is never a `no-wallet` error. Valid from `choosing` AND
 *  from the open-while-scanning `discovering` state. */
function cancelChoice(s: SessionState): void {
	if (s.status.value !== "choosing" && s.status.value !== "discovering") return
	wipeToIdle(s)
}

// ---------------------------------------------------------------------------------------------
// Verification controller: the emoji match, cancels, disconnects, the switch affordance.
// ---------------------------------------------------------------------------------------------

async function confirmVerification(s: SessionState): Promise<void> {
	if (!s.pending) return
	const flowEpoch = s.epoch
	// `pending` is CLAIMED synchronously: the verification dialog can render in several always-mounted panels, and two
	// same-tick confirms would otherwise both call confirm() and race competing wallet wrappers over one MessagePort.
	const flowPending = s.pending
	const flowProvider = s.provider
	s.pending = null
	try {
		const w = await flowPending.confirm()
		if (isStale(s, flowEpoch)) {
			await disconnectStaleSession(flowProvider)
			return
		}
		s.wallet.value = w
		s.verificationEmojis.value = null
		// Subscribe AFTER confirm: before the wallet exists the SDK returns a no-op unsubscriber and the callback never
		// fires. The handler is a REMOTE interruption: it must bump the epoch (stale-ify in-flight continuations like
		// registerContracts) and release the flow, or a late continuation could set "connected" over the wiped state.
		s.unsubscribeDisconnect =
			flowProvider?.onDisconnect(() => {
				if (s.connectingViaRemembered) clearPreferred(s)
				wipeToIdle(s)
			}) ?? null
		s.status.value = "capability-approval"
		await requestCapabilities(s, flowEpoch)
	} catch (err) {
		if (isStale(s, flowEpoch)) return
		if (s.connectingViaRemembered) clearPreferred(s)
		s.error.value = normalizeError(err)
		s.status.value = "error"
		cleanupSession(s)
		releaseFlowIfOwner(s, flowEpoch)
	}
}

async function cancelVerification(s: SessionState): Promise<void> {
	const stalePending = s.pending
	if (s.connectingViaRemembered) clearPreferred(s)
	wipeToIdle(s)
	// SDK teardown AFTER the synchronous wipe, on the captured handle.
	if (stalePending) {
		try {
			await stalePending.cancel()
		} catch {
			// best-effort
		}
	}
}

/** Returns whether the request actually ran: a caller waiting on a grant must be able to tell "the wallet was busy"
 *  from "the wallet answered", or a no-op reads as a refusal. */
async function retryCapabilities(s: SessionState): Promise<boolean> {
	if (!s.wallet.value) return false
	// While the INITIAL capability request (or any other flow) is live, retry is a no-op: concurrent requestCapabilities
	// runs could interleave grants and contract setup.
	if (s.activeFlowEpoch !== null) return false
	const flowEpoch = s.epoch
	s.activeFlowEpoch = flowEpoch
	s.error.value = null
	// A CONNECTED session asking for one more permission stays connected on screen: the wallet's prompt is the caller's
	// own phase to narrate, and a panel that flips to "awaiting permissions" reads as a connection lost and re-made.
	// A retry from an error state walks the statuses as a fresh connect does.
	const quiet = s.status.value === "connected"
	if (!quiet) s.status.value = "capability-approval"
	// A re-grant re-registers contracts; a send that raced the window would hit an unregistered contract, so readiness
	// drops now and finishSetup raises it once registration lands.
	s.contractsReady.value = false
	await requestCapabilities(s, flowEpoch, quiet)
	return true
}

/** Quietly re-register the app's contracts on the current wallet, epoch-fenced exactly like `finishSetup`. A
 *  completion that finds the session moved on returns `false` without publishing into the newer wallet. */
async function reregisterContracts(s: SessionState): Promise<boolean> {
	const flowWallet = s.wallet.value
	if (!flowWallet || s.activeFlowEpoch !== null) return false
	const flowEpoch = s.epoch
	s.activeFlowEpoch = flowEpoch
	s.contractsReady.value = false
	try {
		await s.config.registerContracts(flowWallet)
		if (isStale(s, flowEpoch)) return false
		s.contractsReady.value = true
		releaseFlowIfOwner(s, flowEpoch)
		return true
	} catch (err) {
		if (isStale(s, flowEpoch)) return false
		s.error.value = normalizeError(err)
		s.status.value = "error"
		releaseFlowIfOwner(s, flowEpoch)
		throw err
	}
}

function refreshBlocked(s: SessionState): boolean {
	return s.wallet.value === null || s.status.value !== "connected" || s.activeFlowEpoch !== null || Boolean(s.config.isSwitchBlocked?.())
}

/** Re-read the granted accounts (`getAccounts`, no prompt). A retry or a switch never advances the flow epoch, so
 *  completion is checked by state: the accounts array identity, the selection and the status must be what they were
 *  before the await. */
async function refreshAccounts(s: SessionState): Promise<RefreshOutcome> {
	if (refreshBlocked(s)) return "skipped"
	const wallet = s.wallet.value as Wallet
	const captured = s.accounts.value
	const selected = s.selectedAccount.value
	let raw: unknown
	try {
		raw = await wallet.getAccounts()
	} catch {
		return "skipped"
	}
	if (refreshBlocked(s) || s.accounts.value !== captured || s.selectedAccount.value !== selected) return "dropped"
	const { accounts, hiddenCount } = parseAccountList(Array.isArray(raw) ? raw : null, { keep: selected ?? undefined })
	const first = accounts[0]
	if (!first) return "skipped"
	s.accounts.value = accounts
	s.hiddenAccountsCount.value = hiddenCount
	if (!accounts.some((a) => a.address === selected)) applySelection(s, first.address, s.provider)
	return "refreshed"
}

async function disconnect(s: SessionState): Promise<void> {
	const staleProvider = s.provider
	wipeToIdle(s)
	if (staleProvider) {
		try {
			await staleProvider.disconnect()
		} catch {
			// best-effort
		}
	}
}

/** Disconnect (if connected) + a forced-picker scan in ONE action. The stored preference is KEPT: cancelling the
 *  picker must not cost the user their remembered wallet, and completing a connection overwrites it anyway. */
async function switchWallet(s: SessionState): Promise<void> {
	if (s.status.value === "connected") {
		await disconnect(s)
	}
	await connectImpl(s, true)
}

// ---------------------------------------------------------------------------------------------
// Capability controller: the grant request and the account choice.
// ---------------------------------------------------------------------------------------------

async function requestCapabilities(s: SessionState, flowEpoch: number, quiet = false): Promise<void> {
	const flowWallet = s.wallet.value
	const flowProvider = s.provider
	if (!flowWallet) return
	try {
		const manifest = await s.config.buildManifest()
		if (isStale(s, flowEpoch)) {
			await disconnectStaleSession(flowProvider)
			return
		}
		// The SDK's manifest type is zod-inferred and structurally matches what the builder returns; one cast at the boundary.
		const result = await flowWallet.requestCapabilities(manifest as Parameters<Wallet["requestCapabilities"]>[0])
		if (isStale(s, flowEpoch)) {
			await disconnectStaleSession(flowProvider)
			return
		}
		const { accounts: granted, hiddenCount } = parseGrantedAccounts(result, quiet ? { keep: s.selectedAccount.value ?? undefined } : {})
		// Published BEFORE the account step: an approval replaces the stored grant wholesale, so the answer is
		// authoritative even when the flow then pauses for a choice.
		s.grantedContracts.value = parseGrantedContracts(manifest, result)
		if (chooseGrantedAccount(s, granted, hiddenCount, flowWallet, flowProvider, flowEpoch, quiet) === "paused") return
	} catch (err) {
		if (isStale(s, flowEpoch)) return
		if (s.connectingViaRemembered) clearPreferred(s)
		s.error.value = normalizeError(err)
		s.status.value = "error"
		releaseFlowIfOwner(s, flowEpoch)
		return
	}
	await finishSetup(s, flowEpoch, flowWallet, flowProvider, quiet)
}

/** Apply the grant synchronously: publish it, reject an empty one (the caller's catch owns the error), disclose
 *  truncation, then either select (single account, or a remembered match) or pause the flow on the captured token
 *  for the choose-account modal. */
function chooseGrantedAccount(
	s: SessionState,
	granted: GrantedAccount[],
	hiddenCount: number,
	flowWallet: Wallet,
	flowProvider: WalletProvider | null,
	flowEpoch: number,
	quiet = false,
): "paused" | "chosen" {
	if (granted.length === 0) {
		throw new Error("No accounts granted by wallet")
	}
	// A re-grant on a CONNECTED session is not a fresh connect: the active account stands while the wallet still grants
	// it (no re-selection, no re-persist, no chooser). A grant that DROPPED it pauses for a choice like a fresh connect,
	// and while an operation holds the switch gate only the user may make that choice, once the gate opens, so the
	// operation keeps the account it captured and nothing new starts under a revoked one.
	const active = s.selectedAccount.value
	if (quiet && active !== null && granted.some((a) => a.address === active)) {
		s.accounts.value = granted
		s.hiddenAccountsCount.value = hiddenCount
		return "chosen"
	}
	const gateHeld = quiet && Boolean(s.config.isSwitchBlocked?.())
	s.accounts.value = granted
	s.hiddenAccountsCount.value = hiddenCount
	if (hiddenCount > 0) {
		pushSelectionNotice(s, { kind: "grant-truncated", hiddenCount })
	}

	const only = granted.length === 1 ? granted[0] : undefined
	if (only && !gateHeld) {
		applySelection(s, only.address, flowProvider)
		return "chosen"
	}
	const remembered = flowProvider && !gateHeld ? readRememberedAccount(s, flowProvider.id) : null
	const match = remembered ? granted.find((a) => a.address === remembered) : undefined
	if (match) {
		// Auto-apply, but SAY so: a visible signal that a stored value picked the account.
		applySelection(s, match.address, flowProvider)
		pushSelectionNotice(s, { kind: "auto-remembered", alias: match.alias, address: match.address })
		return "chosen"
	}
	// Pause for the user. The flow stays OWNED (activeFlowEpoch keeps its value), so retryCapabilities stays a no-op
	// while the modal is up; confirm/cancel resume via the captured token.
	s.pendingAccountChoice = { flowEpoch, wallet: flowWallet, provider: flowProvider }
	s.status.value = "choosing-account"
	return "paused"
}

// ---------------------------------------------------------------------------------------------
// Setup controller: post-approval contract registration, the account modal, switching, reset.
// ---------------------------------------------------------------------------------------------

/** Shared post-selection tail for BOTH the auto path and the choose-account confirm path. Owns its errors identically
 *  for both callers; it never throws. */
async function finishSetup(
	s: SessionState,
	flowEpoch: number,
	flowWallet: Wallet,
	flowProvider: WalletProvider | null,
	/** A re-grant on a session that is already connected: the status stays put throughout. */
	quiet = false,
): Promise<void> {
	s.contractsReady.value = false
	try {
		// Registering contracts with the wallet's PXE can take seconds; a dedicated status keeps the UI from saying
		// "awaiting permissions" after the user already approved.
		if (!quiet) s.status.value = "setting-up"
		await s.config.registerContracts(flowWallet)
		if (isStale(s, flowEpoch)) {
			await disconnectStaleSession(flowProvider)
			return
		}

		s.contractsReady.value = true
		s.status.value = "connected"
		// Persisted ONLY on full success. The remembered path re-persists solely when the key was cleared meanwhile, so a
		// stale stored value is never blessed by anything short of a complete connect.
		if (flowProvider && (!s.connectingViaRemembered || readPreferredFor(s.storageKey) === null)) {
			writePreferred(s, { id: flowProvider.id, name: flowProvider.name })
		}
		s.connectingViaRemembered = false
		releaseFlowIfOwner(s, flowEpoch)
	} catch (err) {
		if (isStale(s, flowEpoch)) return
		if (s.connectingViaRemembered) clearPreferred(s)
		s.error.value = normalizeError(err)
		s.status.value = "error"
		releaseFlowIfOwner(s, flowEpoch)
	}
}

/** The choose-account modal's Confirm. Claims the pause token SYNCHRONOUSLY (double-confirm and racing panels are
 *  no-ops), validates the address against the LIVE grant, then resumes the connect flow. */
async function confirmAccountChoice(s: SessionState, address: string): Promise<void> {
	if (s.status.value !== "choosing-account") return
	// The same gate as selectAccount: a choice is a switch, and an operation that started while the chooser was up
	// still owns the account it captured. The chooser stays up; confirm again later.
	if (s.selectedAccount.value !== null && s.config.isSwitchBlocked?.()) return
	const token = s.pendingAccountChoice
	if (!token || isStale(s, token.flowEpoch)) return
	if (!s.accounts.value.some((a) => a.address === address)) return
	s.pendingAccountChoice = null
	applySelection(s, address, token.provider)
	await finishSetup(s, token.flowEpoch, token.wallet, token.provider)
}

/** Dismiss the choose-account step: abandoning the choice cancels the CONNECT (same semantics as cancelVerification;
 *  a half-connected session must not linger). SDK teardown happens AFTER the synchronous wipe, on the token's
 *  captured handle. */
async function cancelAccountChoice(s: SessionState): Promise<void> {
	if (s.status.value !== "choosing-account") return
	const token = s.pendingAccountChoice
	s.pendingAccountChoice = null
	wipeToIdle(s)
	if (token?.provider) {
		try {
			await token.provider.disconnect()
		} catch {
			// best-effort
		}
	}
}

/** Post-connect account switching, gated at the MUTATION BOUNDARY: rejects unless connected, the address is in the
 *  live grant, and no tracked operation is in flight. Returns whether the switch applied. */
function selectAccount(s: SessionState, address: string): boolean {
	if (s.status.value !== "connected") return false
	if (s.config.isSwitchBlocked?.()) return false
	if (!s.accounts.value.some((a) => a.address === address)) return false
	applySelection(s, address, s.provider)
	return true
}

/** Hard reset. Live SDK handles get the same best-effort teardown as the production paths: a reset must not leak a
 *  pending channel or a connected provider session. */
function reset(s: SessionState): void {
	s.autoReconnectDisabled.value = false
	const stalePending = s.pending
	const staleProvider = s.provider
	wipeToIdle(s)
	// Promise.resolve tolerates both promise-returning and void-typed SDK teardown signatures; try/catch covers
	// synchronous throws.
	try {
		if (stalePending) void Promise.resolve(stalePending.cancel()).catch(() => {})
	} catch {
		// best-effort
	}
	try {
		if (staleProvider) void Promise.resolve(staleProvider.disconnect()).catch(() => {})
	} catch {
		// best-effort
	}
}

// ---------------------------------------------------------------------------------------------
// Grant parsing: the capability result is WALLET-CONTROLLED input.
// ---------------------------------------------------------------------------------------------

interface GrantedAccountsCap {
	type: "accounts"
	accounts?: Array<{ alias?: unknown; item?: { toString(): string } | string } | null>
}

export interface ParsedGrantedAccounts {
	readonly accounts: GrantedAccount[]
	/** Valid, deduped accounts dropped by the MAX_GRANTED_ACCOUNTS cap. */
	readonly hiddenCount: number
}

/**
 * Per entry, inside try/catch: the address must round-trip `AztecAddress.fromStringUnsafe` (syntactic + canonical-form
 * validation ONLY, not curve validity: authorization is enforced wallet-side per RPC); a throwing `toString` or
 * malformed entry is skipped, never a crash. Aliases are sanitized (control/bidi strip) and capped; addresses deduped
 * (first wins); the list is bounded with DISCLOSED truncation.
 */
export function parseGrantedAccounts(result: unknown, opts: { keep?: string } = {}): ParsedGrantedAccounts {
	return parseAccountList(findGrantedAccountEntries(result), opts)
}

/** The same hardening over a bare entry list, which is what `getAccounts` answers (no grant envelope). */
export function parseAccountList(
	entries: NonNullable<GrantedAccountsCap["accounts"]> | null,
	opts: { keep?: string } = {},
): ParsedGrantedAccounts {
	if (!entries) return { accounts: [], hiddenCount: 0 }

	const seen = new Set<string>()
	const accounts: GrantedAccount[] = []
	let hiddenCount = 0
	// The alias is untrusted text: it is only sanitized for an entry that takes a displayed slot.
	const displayed = (entry: { alias?: unknown } | null, address: string): GrantedAccount => {
		const rawAlias = typeof entry?.alias === "string" ? entry.alias : ""
		return { address, alias: truncateName(rawAlias.replace(UNSAFE_ALIAS_CHARS, "").trim(), ALIAS_MAX) }
	}
	for (const entry of entries) {
		const address = parseEntryAddress(entry)
		if (address === null) continue
		if (seen.has(address)) continue
		seen.add(address)
		if (accounts.length < MAX_GRANTED_ACCOUNTS) {
			accounts.push(displayed(entry, address))
			continue
		}
		hiddenCount++
		// The selected account stays listed even when the cap would drop it: the wallet's ordering must never move the
		// selection out from under the user.
		if (address === opts.keep) accounts[accounts.length - 1] = displayed(entry, address)
	}
	return { accounts, hiddenCount }
}

/** The accounts capability's entry list out of the wallet-controlled result; null when absent or malformed at any level. */
function findGrantedAccountEntries(result: unknown): NonNullable<GrantedAccountsCap["accounts"]> | null {
	const cap = findGrantedCapability(result, "accounts") as GrantedAccountsCap | null
	if (!cap?.accounts || !Array.isArray(cap.accounts)) return null
	return cap.accounts
}

function parseEntryAddress(entry: { item?: { toString(): string } | string } | null): string | null {
	try {
		const raw = typeof entry?.item === "string" ? entry.item : (entry?.item?.toString() ?? "")
		return AztecAddress.fromStringUnsafe(raw).toString()
	} catch {
		return null
	}
}

/** One capability object out of the wallet-controlled result, by type. */
function findGrantedCapability(result: unknown, type: string): Record<string, unknown> | null {
	if (!result || typeof result !== "object") return null
	const granted = (result as { granted?: unknown[] }).granted
	if (!Array.isArray(granted)) return null
	const cap = granted.find((c) => typeof c === "object" && c !== null && (c as { type?: unknown }).type === type)
	return (cap as Record<string, unknown>) ?? null
}

/** A granted contract entry is a plain address (string or address-like); null when it is neither. */
function parseContractAddress(entry: unknown): string | null {
	try {
		const raw = typeof entry === "string" ? entry : ((entry as { toString(): string } | null)?.toString() ?? "")
		return AztecAddress.fromStringUnsafe(raw).toString().toLowerCase()
	} catch {
		return null
	}
}

/** A `"*"` on either side: a whole contract list, a whole scope, or a pattern's own contract or function. The app never
 *  asks for one, so a wildcard is a shape it cannot attribute to any contract; reading it as "everything is granted"
 *  would turn an odd answer into a permission upgrade. */
const WILDCARD = "*"

/** Bound on the scope entries kept from ONE side. Overflow can only shrink a grant, since a requested scope missing
 *  from the answer reads as a refusal. */
const MAX_SCOPE_ENTRIES = 4_096

type ScopeBucket = "transaction" | "simulation.transactions" | "simulation.utilities"

/** One side of the handshake, flattened: the contracts it names, and per contract the `<bucket>:<function>` scopes
 *  it carries. */
interface CapabilityScopes {
	contracts: string[]
	scopes: Map<string, Set<string>>
	wildcard: boolean
	entries: number
}

/** The app's request and the wallet's answer carry the same capability shapes, so ONE reader covers both sides. */
function collectCapabilityScopes(list: unknown): CapabilityScopes {
	const out: CapabilityScopes = { contracts: [], scopes: new Map(), wildcard: false, entries: 0 }
	if (!Array.isArray(list)) return out
	for (const cap of list) {
		const entry = cap as { type?: unknown; contracts?: unknown; scope?: unknown; transactions?: unknown; utilities?: unknown } | null
		if (entry?.type === "contracts") readContractList(entry.contracts, out)
		else if (entry?.type === "transaction") readScope(entry.scope, "transaction", out)
		else if (entry?.type === "simulation") {
			readScope((entry.transactions as { scope?: unknown } | undefined)?.scope, "simulation.transactions", out)
			readScope((entry.utilities as { scope?: unknown } | undefined)?.scope, "simulation.utilities", out)
		}
	}
	return out
}

function readContractList(value: unknown, out: CapabilityScopes): void {
	if (value === WILDCARD) {
		out.wildcard = true
		return
	}
	if (!Array.isArray(value)) return
	for (const entry of value) {
		if (out.contracts.length >= MAX_GRANTED_CONTRACTS) return
		const address = parseContractAddress(entry)
		if (address !== null && !out.contracts.includes(address)) out.contracts.push(address)
	}
}

function readScope(scope: unknown, bucket: ScopeBucket, out: CapabilityScopes): void {
	if (scope === WILDCARD) {
		out.wildcard = true
		return
	}
	if (!Array.isArray(scope)) return
	for (const pattern of scope) {
		if (out.entries >= MAX_SCOPE_ENTRIES) return
		const entry = pattern as { contract?: unknown; function?: unknown } | null
		if (entry?.contract === WILDCARD || entry?.function === WILDCARD) {
			out.wildcard = true
			return
		}
		const address = parseContractAddress(entry?.contract)
		if (address === null || typeof entry?.function !== "string") continue
		const keys = out.scopes.get(address) ?? new Set<string>()
		keys.add(`${bucket}:${entry.function}`)
		out.scopes.set(address, keys)
		out.entries++
	}
}

/** Every scope the request named for one contract must come back. A wallet that grants the contract but drops its
 *  transaction or simulation scopes has not granted what the app needs on it, and a deposit sent on that answer would
 *  only discover the hole at the Aztec claim. */
function scopesSatisfied(address: string, request: CapabilityScopes, answer: CapabilityScopes): boolean {
	const wanted = request.scopes.get(address)
	if (!wanted) return true
	const given = answer.scopes.get(address)
	if (!given) return false
	for (const key of wanted) {
		if (!given.has(key)) return false
	}
	return true
}

function capabilityListOf(source: unknown, key: "capabilities" | "granted"): unknown {
	if (!source || typeof source !== "object") return null
	return (source as Record<string, unknown>)[key]
}

/**
 * The contracts the app may act on: the requested manifest INTERSECTED with the wallet's answer, lowercased, in
 * request order. Membership in the answer's contract list is not enough: a contract counts only when every scope the
 * request named for it came back too. A contract the app never asked for is ignored, and a `"*"` on either side yields
 * nothing at all. Same per-entry hardening as the account list.
 */
export function parseGrantedContracts(request: unknown, result: unknown): string[] {
	const requested = collectCapabilityScopes(capabilityListOf(request, "capabilities"))
	const answered = collectCapabilityScopes(capabilityListOf(result, "granted"))
	if (requested.wildcard || answered.wildcard) return []
	const granted = new Set(answered.contracts)
	return requested.contracts.filter((address) => granted.has(address) && scopesSatisfied(address, requested, answered))
}
