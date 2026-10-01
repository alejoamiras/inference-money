type UnloadTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">

export interface InFlight {
	add(item: object): void
	remove(item: object): void
	readonly size: number
}

/**
 * Work only this tab can finish. An unclaimed deposit's secret lives in memory alone, so closing the tab loses the
 * deposit; while anything is registered, the page asks before unloading.
 */
export function createInFlight(target: UnloadTarget): InFlight {
	const items = new Set<object>()
	const guard = (e: Event): void => {
		e.preventDefault()
		// Older engines prompt only when returnValue is set.
		;(e as BeforeUnloadEvent).returnValue = ""
	}
	return {
		add(item) {
			if (items.size === 0) target.addEventListener("beforeunload", guard)
			items.add(item)
		},
		remove(item) {
			if (items.delete(item) && items.size === 0) target.removeEventListener("beforeunload", guard)
		},
		get size() {
			return items.size
		},
	}
}
