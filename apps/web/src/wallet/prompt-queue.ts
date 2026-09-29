import type { ConnectStatus } from "./aztec-session"

/** Statuses in which the session already holds a wallet prompt or sits between two of them. */
export const MID_FLOW_STATUSES: ReadonlySet<ConnectStatus> = new Set<ConnectStatus>([
	"discovering",
	"choosing",
	"verifying",
	"capability-approval",
	"choosing-account",
	"setting-up",
])

let tail: Promise<unknown> = Promise.resolve()

/**
 * Runs `run` once every previously enqueued prompt has settled. Wallet prompts share one channel, so two in flight at
 * once race each other's answers; a rejection settles its slot like a resolution, so the chain never wedges.
 */
export function enqueuePrompt<T>(run: () => Promise<T>): Promise<T> {
	const next = tail.then(run, run)
	tail = next.catch(() => undefined)
	return next
}

export function __resetPromptQueueForTests(): void {
	tail = Promise.resolve()
}
