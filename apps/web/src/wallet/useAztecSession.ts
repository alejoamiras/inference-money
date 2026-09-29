import { useSyncExternalStore } from "react"
import type { AztecSessionSnapshot, AztecWalletSession } from "./aztec-session"

/** The session's current snapshot, re-rendering on every change. */
export function useAztecSession(session: AztecWalletSession): AztecSessionSnapshot {
	return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
}
