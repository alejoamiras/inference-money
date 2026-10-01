import type { Actor, User } from "@inference-money/demo"
import type { KeyValue } from "./store"

/** A deposit this page sent: its draft until it mines, then its claim ticket until the claim lands. */
export interface PendingDeposit {
	id: string
	user: User
	since: number
	/** `encodeTicket("draft", …)`, kept from the moment it may be broadcast, so a reload never deposits twice. */
	draft?: string
	/** `encodeTicket("claim", …)`. */
	claim?: string
}

/** An exit this page sent, until its withdrawal pays out on Ethereum. */
export interface PendingExit {
	id: string
	actor: Actor
	since: number
	/** `encodeTicket("exit", …)`. */
	ticket: string
}

/** The page's unfinished cross-chain steps, which a reload resumes. */
export interface Tickets {
	deposits(): PendingDeposit[]
	putDeposit(d: PendingDeposit): void
	dropDeposit(id: string): void
	exits(): PendingExit[]
	putExit(e: PendingExit): void
	dropExit(id: string): void
}

/** Oldest first; an entry that no longer parses is skipped, never thrown. */
function read<T extends { since: number }>(kv: KeyValue, kind: string): T[] {
	return kv
		.keys()
		.filter((k) => k.startsWith(`${kind}:`))
		.flatMap((k) => {
			try {
				const raw = kv.get(k)
				return raw === undefined ? [] : [JSON.parse(raw) as T]
			} catch {
				return []
			}
		})
		.sort((a, b) => a.since - b.since)
}

export function tickets(kv: KeyValue): Tickets {
	return {
		deposits: () => read<PendingDeposit>(kv, "deposit"),
		putDeposit: (d) => kv.set(`deposit:${d.id}`, JSON.stringify(d)),
		dropDeposit: (id) => kv.set(`deposit:${id}`, undefined),
		exits: () => read<PendingExit>(kv, "exit"),
		putExit: (e) => kv.set(`exit:${e.id}`, JSON.stringify(e)),
		dropExit: (id) => kv.set(`exit:${id}`, undefined),
	}
}
