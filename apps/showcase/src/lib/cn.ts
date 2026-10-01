import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))

/** `0x1234…abcd`: enough to recognize, never enough to trust; the full value is always one hover away. */
export function shortHex(value: string, head = 6, tail = 4): string {
	return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}
