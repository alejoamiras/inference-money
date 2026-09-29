/**
 * One-shot fault injection, matched by method and, optionally, by a substring of the call's serialized arguments (the
 * target contract or function): a `fail` answers with an error; a `hold` parks the call unanswered until released, a
 * wallet gone mid-call; a `swallow` runs the call but never answers, a wallet that sent the tx and lost the reply.
 */
export type Fault = { method: string; pattern?: string } & ({ kind: "fail"; message: string } | { kind: "hold" } | { kind: "swallow" })

export interface Parked {
	run: () => void
}

const serialize = (args: readonly unknown[]) => JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v))

export function faultFor(f: Fault, method: string, args: readonly unknown[]): Fault | undefined {
	if (f.method !== method) return undefined
	return f.pattern === undefined || serialize(args).includes(f.pattern) ? f : undefined
}

export function parkedCall(f: Fault, run: () => Promise<unknown>, parked: Parked[]): Promise<unknown> {
	if (f.kind === "fail") return Promise.reject(new Error(f.message))
	if (f.kind === "swallow") {
		void run().catch(() => {})
		return new Promise<never>(() => {})
	}
	return new Promise((resolve, reject) => parked.push({ run: () => void run().then(resolve, reject) }))
}
