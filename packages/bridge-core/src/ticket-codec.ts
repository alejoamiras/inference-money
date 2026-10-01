import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import type { ClaimTicket, DepositDraft } from "./deposit"
import type { ExitTicket } from "./exit"
import { PROTOCOL_VERSION } from "./manifest"

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

/** Tags every value JSON cannot carry, so a ticket reads back with its types; `toJSON` would flatten them first. */
function encode(v: unknown): Json {
	if (typeof v === "bigint") return { $bigint: v.toString() }
	if (v instanceof Fr) return { $fr: v.toString() }
	if (v instanceof AztecAddress) return { $aztec: v.toString() }
	if (v instanceof TxHash) return { $tx: v.toString() }
	if (Array.isArray(v)) return v.map(encode)
	if (v !== null && typeof v === "object") {
		return Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (x === undefined ? [] : [[k, encode(x)]])))
	}
	return v as Json
}

const TAGS: Record<string, (s: string) => unknown> = {
	$bigint: (s) => BigInt(s),
	$fr: (s) => Fr.fromHexString(s),
	$aztec: (s) => AztecAddress.fromStringUnsafe(s),
	$tx: (s) => TxHash.fromString(s),
}

function decode(v: Json): unknown {
	if (Array.isArray(v)) return v.map(decode)
	if (v === null || typeof v !== "object") return v
	const [tag, ...rest] = Object.keys(v)
	if (tag && rest.length === 0 && tag in TAGS && typeof v[tag] === "string") return TAGS[tag]!(v[tag] as string)
	return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
}

type Kind = "draft" | "claim" | "exit"
interface Stored {
	protocolVersion: number
	kind: Kind
	ticket: Json
}

/**
 * A ticket, or a deposit draft (a claim ticket before its deposit is confirmed), as durable JSON stamped with the
 * protocol version it was made under. Drafts and claim tickets hold their deposit's secret: store them as such.
 */
export function encodeTicket(kind: "draft", t: DepositDraft): string
export function encodeTicket(kind: "claim", t: ClaimTicket): string
export function encodeTicket(kind: "exit", t: ExitTicket): string
export function encodeTicket(kind: Kind, t: DepositDraft | ClaimTicket | ExitTicket): string {
	return JSON.stringify({ protocolVersion: PROTOCOL_VERSION, kind, ticket: encode(t) } satisfies Stored)
}

function decodeTicket(kind: Kind, json: string): unknown {
	const s = JSON.parse(json) as Stored
	if (s.protocolVersion !== PROTOCOL_VERSION) {
		throw new Error(
			`A protocol ${s.protocolVersion} ticket needs the CLI of the commit that made it (this one speaks ${PROTOCOL_VERSION}).`,
		)
	}
	if (s.kind !== kind) throw new Error(`expected a ${kind} ticket, got a ${s.kind} ticket`)
	return decode(s.ticket)
}

export const decodeDepositDraft = (json: string): DepositDraft => decodeTicket("draft", json) as DepositDraft
export const decodeClaimTicket = (json: string): ClaimTicket => decodeTicket("claim", json) as ClaimTicket
export const decodeExitTicket = (json: string): ExitTicket => decodeTicket("exit", json) as ExitTicket
