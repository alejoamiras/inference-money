import { describe, expect, it } from "bun:test"
import { claimBinding, fundingAddress, NotFundingAddressError } from "@inference-money/bridge-core"
import { type Address, isAddressEqual } from "viem"
import { claimable, claimFor, deposit, l1Actor, l2Actor, l2Balances, openBooks, returnable, returnFor, USDC } from "./actors"
import { harness, INTEGRATION } from "./harness"

const boundTo = async (account: Parameters<typeof fundingAddress>[2]): Promise<Address | undefined> =>
	fundingAddress(harness().wallet, harness().manifest, account)

describe.skipIf(!INTEGRATION)("funding-address binding", () => {
	it("[A23] the first private claim binds the account to its depositor; later deposits claim only from there", async () => {
		const { wallet, manifest: m } = harness()
		const [l1, other, bob] = await Promise.all([l1Actor(), l1Actor(), l2Actor()])
		const books = await openBooks()
		expect(await boundTo(bob)).toBeUndefined()

		const first = books.deposit(await deposit(l1, "private", bob, 2n * USDC))
		await claimable(first, bob)
		expect(await claimBinding(wallet, m, bob, first.depositor), "the app warns before this claim").toBe("binds")
		expect(await claimFor(first)).toBe("claimed")
		const bound = await boundTo(bob)
		expect(bound !== undefined && isAddressEqual(bound, l1.account)).toBe(true)

		const again = books.deposit(await deposit(l1, "private", bob, USDC))
		await claimable(again, bob)
		expect(await claimFor(again)).toBe("claimed")

		// Refused by the preflight before any proof; the bridge refuses the same claim on chain (TXE binding suite).
		const stranger = books.deposit(await deposit(other, "private", bob, USDC))
		await expect(claimable(stranger, bob)).rejects.toBeInstanceOf(NotFundingAddressError)
		await expect(claimFor(stranger)).rejects.toBeInstanceOf(NotFundingAddressError)
		expect((await l2Balances(bob)).private).toBe(3n * USDC)
		await returnable(stranger)
		books.withdrawal(await returnFor(stranger))
		await books.settle()
	})

	it("[A23] a first-claim race: two first claims from different depositors both prove, one binds, the other is returned", async () => {
		const [a, b, bob] = await Promise.all([l1Actor(), l1Actor(), l2Actor()])
		const books = await openBooks()
		const ta = books.deposit(await deposit(a, "private", bob, USDC))
		const tb = books.deposit(await deposit(b, "private", bob, 2n * USDC))
		await Promise.all([claimable(ta, bob), claimable(tb, bob)])

		const outcomes = await Promise.allSettled([claimFor(ta), claimFor(tb)])
		const won = outcomes.flatMap((o, i) => (o.status === "fulfilled" && o.value === "claimed" ? [i] : []))
		expect(won, JSON.stringify(outcomes.map((o) => o.status))).toHaveLength(1)
		const [winner, loser] = won[0] === 0 ? [ta, tb] : [tb, ta]
		const bound = await boundTo(bob)
		expect(bound !== undefined && isAddressEqual(bound, winner.depositor)).toBe(true)
		expect((await l2Balances(bob)).private).toBe(winner.draft.intent.amount)

		await expect(claimFor(loser)).rejects.toBeInstanceOf(NotFundingAddressError)
		const payout = books.withdrawal(await returnFor(loser))
		expect(isAddressEqual(payout.recipient, loser.depositor)).toBe(true)
		await books.settle()
	})
})
