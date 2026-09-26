/**
 * The page the app frames. The connection handler starts synchronously (the `late` profile excepted) so the SDK's
 * discovery probe always finds it; the wallet itself, a PXE, boots on the first secure message.
 */
import { Fr } from "@aztec/aztec.js/fields"
import { IframeConnectionHandler } from "@aztec/wallet-sdk/iframe/handlers"
import { type Fault, faultFor, type Parked, parkedCall } from "./faults"
import { violation } from "./guard"
import { APP_ID, LATE_WALLET_DELAY_MS, parseProfile, seedsFor, walletIdOf } from "./profile"
import type { TestWallet } from "./wallet"

const identity = __TEST_WALLET__
const profile = parseProfile(new URL(location.href).searchParams.get("profile"))

const logEl = document.getElementById("log") as HTMLPreElement
const line = (level: string, message: string, data?: unknown) => {
	logEl.textContent += `[${level}] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`
	console[level === "error" ? "error" : "log"](`[test-wallet:${profile}] ${message}`, data ?? "")
}
const logger = {
	debug: () => {},
	info: (m: string, d?: unknown) => line("info", m, d),
	warn: (m: string, d?: unknown) => line("warn", m, d),
	error: (m: string, d?: unknown) => line("error", m, d),
}

let booting: Promise<TestWallet> | undefined
function boot(): Promise<TestWallet> {
	booting ??= (async () => {
		const { TestWallet } = await import("./wallet")
		const wallet = await TestWallet.createFor(identity)
		for (const seed of seedsFor(profile, window.__testWalletSeeds ?? [])) line("info", `imported ${await wallet.importSeed(seed)}`)
		return wallet
	})()
	return booting
}

let fault: Fault | undefined
const parked: Parked[] = []
const calls: Record<string, number> = {}
const denials: string[] = []
let callSeq = 0

/** Enforcement first, then the armed fault: an ungranted call is refused even when a fault targets it. */
function traced(wallet: TestWallet): TestWallet {
	return new Proxy(wallet, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver)
			if (typeof value !== "function" || typeof prop !== "string") return value
			return async (...args: unknown[]) => {
				const id = ++callSeq
				calls[prop] = (calls[prop] ?? 0) + 1
				line("info", `→ ${prop} #${id}`)
				const denied = await violation(target.grant, prop, args)
				if (denied) {
					denials.push(denied)
					line("warn", `✗ ${prop} #${id} denied: ${denied}`)
					throw new Error(`Capability denied: ${denied} is outside what this app was granted`)
				}
				const run = () => Promise.resolve(value.apply(target, args))
				const armed = fault && faultFor(fault, prop, args)
				if (!armed) return run()
				fault = undefined
				line("warn", `injected ${armed.kind} on ${prop} #${id}`)
				return parkedCall(armed, run, parked)
			}
		},
	})
}

const asBigInt = (v: unknown) => Fr.fromString(String(v)).toBigInt()
function assertLocalChain(chainInfo: unknown): void {
	const { chainId, version } = chainInfo as { chainId: unknown; version: unknown }
	if (asBigInt(chainId) !== BigInt(identity.l1ChainId) || asBigInt(version) !== BigInt(identity.rollupVersion)) {
		throw new Error(`test wallet: chain ${String(chainId)}/${String(version)} is not the local network`)
	}
}

const handler = new IframeConnectionHandler(
	{
		walletId: walletIdOf(profile),
		walletName: `Test wallet (${profile})`,
		walletVersion: "0.0.0",
		allowedOrigins: [identity.appOrigin],
		logger,
	},
	{
		onPendingDiscovery: (session) => handler.approveDiscovery(session.requestId),
		getWallet: (appId, chainInfo) => {
			if (appId !== APP_ID) throw new Error(`test wallet: app "${appId}" is not the bridge`)
			assertLocalChain(chainInfo)
			return boot().then(traced)
		},
	},
)
if (profile === "late") setTimeout(() => handler.start(), LATE_WALLET_DELAY_MS)
else handler.start()
;(document.getElementById("profile") as HTMLElement).textContent = profile

const arm = (f: Fault) => {
	fault = f
}
window.__testWallet = {
	profile,
	ready: () => boot().then(() => undefined),
	accounts: async () => (await boot()).getAccounts().then((list) => list.map((a) => a.item.toString())),
	calls: () => ({ ...calls }),
	denied: () => [...denials],
	submitted: async () => [...(await boot()).submitted],
	failNext: (method, pattern, message = `test wallet: injected failure of ${method}`) => arm({ kind: "fail", method, pattern, message }),
	holdNext: (method, pattern) => arm({ kind: "hold", method, pattern }),
	swallowNext: (method, pattern) => arm({ kind: "swallow", method, pattern }),
	release: () => {
		const held = parked.splice(0)
		for (const p of held) p.run()
		return held.length
	},
	dropNextSubmission: async () => {
		;(await boot()).dropNextSubmission = true
	},
	declineNextGrant: async () => {
		;(await boot()).declineNextGrant = true
	},
}
