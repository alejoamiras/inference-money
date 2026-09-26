/**
 * Runs `fn` while forcing a block every `intervalMs`. The local network builds a block only when a tx arrives, so a
 * wait on chain progress (an L1→L2 message becoming consumable, an epoch proving) never advances without one.
 * `forceBlock` failures are ignored: a missed beat only delays the next one.
 */
export async function withBlockHeartbeat<T>(forceBlock: () => Promise<unknown>, fn: () => Promise<T>, intervalMs = 3_000): Promise<T> {
	let beating = true
	let wake: () => void = () => {}
	const beats = (async () => {
		while (beating) {
			await forceBlock().catch(() => {})
			await new Promise<void>((r) => {
				wake = r
				setTimeout(r, intervalMs)
			})
		}
	})()
	try {
		return await fn()
	} finally {
		beating = false
		wake()
		await beats
	}
}
