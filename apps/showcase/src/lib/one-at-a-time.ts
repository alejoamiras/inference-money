/** A queue: each function it runs starts once the previous one has settled, whether it resolved or threw. */
export function oneAtATime(): <T>(fn: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve()
	return (fn) => {
		const run = tail.then(fn)
		tail = run.catch(() => undefined)
		return run
	}
}
