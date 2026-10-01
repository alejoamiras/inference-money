import { describe, expect, it } from "vitest"
import { browserPaymentStore, localKeyValue } from "./store"
import { tickets } from "./tickets"

/** The page's storage, but refusing every write, as a full quota or blocked site data does. */
const fullStorage = (): Storage => {
	const refuse = () => {
		throw new DOMException("quota", "QuotaExceededError")
	}
	return {
		get length() {
			return localStorage.length
		},
		key: (i) => localStorage.key(i),
		getItem: (k) => localStorage.getItem(k),
		setItem: refuse,
		removeItem: refuse,
		clear: refuse,
	}
}

describe("browser stores", () => {
	it("keep each deployment's records apart, survive a new store on the same storage, and keep a failed write for the page", () => {
		const a = localKeyValue("im/a/")
		a.set("x", "1")
		expect(localKeyValue("im/a/").get("x")).toBe("1")
		expect(localKeyValue("im/b/").get("x")).toBeUndefined()
		const full = localKeyValue("im/a/", fullStorage())
		full.set("y", "2")
		expect([full.get("y"), localKeyValue("im/a/").get("y")]).toEqual(["2", undefined])
		expect(full.keys().sort()).toEqual(["x", "y"])
	})

	it("hold a payment record across a reload, and lock through Web Locks when the browser has them", async () => {
		const held: string[] = []
		const request = async (name: string, fn: () => Promise<unknown>) => {
			held.push(name)
			return fn()
		}
		const locks = { request } as unknown as LockManager
		const store = browserPaymentStore(localKeyValue("im/a/"), locks)
		await store.locked("k", () => store.put("k", { state: "sent", owner: "o", txHash: "0x1", expiresAt: "9" }))
		expect(held).toEqual(["payment:k"])
		expect(await browserPaymentStore(localKeyValue("im/a/"), undefined).get("k")).toEqual({
			state: "sent",
			owner: "o",
			txHash: "0x1",
			expiresAt: "9",
		})
	})

	it("list pending deposits and exits oldest first, and skip an entry that no longer parses", () => {
		const kv = localKeyValue("im/a/")
		const t = tickets(kv)
		t.putExit({ id: "e2", actor: "alice", since: 2, ticket: "t2" })
		t.putExit({ id: "e1", actor: "bob", since: 1, ticket: "t1" })
		kv.set("exit:broken", "{")
		t.putDeposit({ id: "d1", user: "alice", since: 3, draft: "d" })
		expect(t.exits().map((e) => e.id)).toEqual(["e1", "e2"])
		t.dropExit("e1")
		expect(t.exits().map((e) => e.id)).toEqual(["e2"])
		expect(t.deposits()).toEqual([{ id: "d1", user: "alice", since: 3, draft: "d" }])
	})
})
