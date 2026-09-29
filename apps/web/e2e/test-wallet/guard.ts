/**
 * Capability enforcement, as a real wallet does it: after a grant, every call the app makes is checked against what
 * was granted, and anything outside it is refused before it reaches the PXE. Without this the suite could not tell an
 * app that asks for the right grant from one that merely works against a permissive wallet.
 */
import { computeContractAddressFromInstance } from "@aztec/stdlib/contract"

type Named = { toString(): string }
type ScopeEntry = { contract?: Named | string; function?: string }

export interface Grant {
	readonly contracts: ReadonlySet<string>
	readonly transaction: ReadonlySet<string>
	readonly simulation: ReadonlySet<string>
	readonly utilities: ReadonlySet<string>
	readonly canGetAccounts: boolean
	readonly canCreateAuthWit: boolean
	readonly canGetMetadata: boolean
}

const key = (contract: Named | string | undefined, fn: string | undefined) => `${String(contract).toLowerCase()}:${fn}`

function scopeSet(scope: unknown): Set<string> {
	if (!Array.isArray(scope)) return new Set()
	return new Set((scope as ScopeEntry[]).map((e) => key(e.contract, e.function)))
}

type Capability = { type?: string; [k: string]: unknown }

/** The grant a wallet answer carries; a capability missing from the answer grants nothing. */
export function grantFrom(granted: readonly Capability[]): Grant {
	const find = (type: string) => granted.find((c) => c.type === type)
	const accounts = find("accounts")
	const contractsCap = find("contracts")
	const contracts = contractsCap?.contracts
	const simulation = find("simulation") as { transactions?: { scope?: unknown }; utilities?: { scope?: unknown } } | undefined
	return {
		contracts: new Set(Array.isArray(contracts) ? contracts.map((c: Named) => String(c).toLowerCase()) : []),
		transaction: scopeSet(find("transaction")?.scope),
		simulation: scopeSet(simulation?.transactions?.scope),
		utilities: scopeSet(simulation?.utilities?.scope),
		canGetAccounts: accounts?.canGet === true,
		canCreateAuthWit: accounts?.canCreateAuthWit === true,
		canGetMetadata: contractsCap?.canGetMetadata === true,
	}
}

type Call = { to: Named; name: string }

function callsOutside(allowed: ReadonlySet<string>, exec: unknown, what: string): string | undefined {
	const calls = (exec as { calls?: Call[] } | undefined)?.calls ?? []
	const outside = calls.find((c) => !allowed.has(key(c.to, c.name)))
	return outside ? `${what} of ${outside.to.toString()}.${outside.name}` : undefined
}

async function addressOf(instance: unknown): Promise<string> {
	const withAddress = instance as { address?: Named }
	if (withAddress.address) return withAddress.address.toString().toLowerCase()
	return (await computeContractAddressFromInstance(instance as never)).toString().toLowerCase()
}

async function authWitOutside(g: Grant, intent: unknown): Promise<string | undefined> {
	if (!g.canCreateAuthWit) return "authwit creation"
	const call = (intent as { call?: Call } | undefined)?.call
	return call && !g.transaction.has(key(call.to, call.name)) ? `authwit for ${call.to.toString()}.${call.name}` : undefined
}

/** What a method call reaches for outside `g`, or undefined when it is inside (or ungated). No grant yet: all gated calls refuse. */
export async function violation(g: Grant | undefined, method: string, args: readonly unknown[]): Promise<string | undefined> {
	if (method === "batch") return batchViolation(g, args[0])
	if (!GATED.has(method)) return undefined
	if (!g) return `${method} before any grant`
	switch (method) {
		case "sendTx":
			return callsOutside(g.transaction, args[0], "send")
		case "simulateTx":
			return callsOutside(g.simulation, args[0], "simulation")
		case "executeUtility":
			return callsOutside(g.utilities, { calls: [args[0]] }, "utility call")
		case "registerContract": {
			const address = await addressOf(args[0])
			return g.contracts.has(address) ? undefined : `registration of ${address}`
		}
		case "createAuthWit":
			return authWitOutside(g, args[1])
		case "getContractMetadata":
		case "getContractClassMetadata":
			return g.canGetMetadata ? undefined : "contract metadata"
		default:
			return g.canGetAccounts ? undefined : "account listing"
	}
}

const GATED = new Set([
	"sendTx",
	"simulateTx",
	"executeUtility",
	"registerContract",
	"createAuthWit",
	"getAccounts",
	"getContractMetadata",
	"getContractClassMetadata",
])

async function batchViolation(g: Grant | undefined, methods: unknown): Promise<string | undefined> {
	for (const m of (methods as { name: string; args: unknown[] }[]) ?? []) {
		const found = await violation(g, m.name, m.args)
		if (found) return found
	}
	return undefined
}
