export interface SwitchGate {
	/** Runs `fn` with Aztec account switching refused: a send leaves from the account it was built for. */
	hold<T>(fn: () => Promise<T>): Promise<T>
	blocked(): boolean
}

export function createSwitchGate(): SwitchGate {
	let held = 0
	return {
		async hold(fn) {
			held++
			try {
				return await fn()
			} finally {
				held--
			}
		},
		blocked: () => held > 0,
	}
}

/** The app's one gate; the Aztec session consults it before every account switch. */
export const switchGate = createSwitchGate()
