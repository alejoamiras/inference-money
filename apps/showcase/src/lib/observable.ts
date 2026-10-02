import { useSyncExternalStore } from "react"

/** A value that changes outside React: read it now, or hear every change. */
export interface Observable<T> {
	get(): T
	/** Returns the unsubscribe. */
	listen(fn: (value: T) => void): () => void
}

export interface Cell<T> extends Observable<T> {
	/** Notifies even when `value` equals the current one: a repeated answer is still an answer. */
	set(value: T): void
}

export function cell<T>(initial: T): Cell<T> {
	let current = initial
	const listeners = new Set<(value: T) => void>()
	return {
		get: () => current,
		set: (value) => {
			current = value
			for (const fn of listeners) fn(value)
		},
		listen: (fn) => {
			listeners.add(fn)
			return () => listeners.delete(fn)
		},
	}
}

const silent = () => () => {}
const nothing = () => undefined

/** The observable's current value in a component, or undefined without one. */
export function useObservable<T>(o: Observable<T> | undefined): T | undefined {
	return useSyncExternalStore(o?.listen ?? silent, o?.get ?? nothing)
}
