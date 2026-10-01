import { useSyncExternalStore } from "react"

/** A flow's state as frozen snapshots: each `set` replaces the snapshot, so React sees every change by identity. */
export interface FlowStore<S> {
	get(): S
	set(patch: Partial<S>): void
	subscribe(listener: () => void): () => void
}

export function createFlowStore<S extends object>(initial: S): FlowStore<S> {
	let snapshot: S = Object.freeze({ ...initial })
	const listeners = new Set<() => void>()
	return {
		get: () => snapshot,
		set(patch) {
			snapshot = Object.freeze({ ...snapshot, ...patch })
			for (const listener of [...listeners]) listener()
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}

export function useFlow<S>(store: FlowStore<S>): S {
	return useSyncExternalStore(store.subscribe, store.get, store.get)
}
