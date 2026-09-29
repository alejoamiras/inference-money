/** A single reactive slot. Writing an `Object.is`-equal value is a no-op; any other write notifies synchronously. */
export interface Cell<T> {
	value: T
}

export interface Store {
	cell<T>(initial: T): Cell<T>
	/** Listeners run synchronously inside the write that changed a cell. */
	subscribe(listener: () => void): () => void
	/** Bumps on every real change: a cheap "anything changed since I last looked" check. */
	version(): number
}

export function createStore(): Store {
	let version = 0
	const listeners = new Set<() => void>()
	const notify = (): void => {
		version++
		// Copied so a listener unsubscribing (or subscribing) mid-notification cannot skip or repeat a peer.
		for (const listener of [...listeners]) listener()
	}
	return {
		cell<T>(initial: T): Cell<T> {
			let current = initial
			return {
				get value(): T {
					return current
				},
				set value(next: T) {
					if (Object.is(current, next)) return
					current = next
					notify()
				},
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		version: () => version,
	}
}
