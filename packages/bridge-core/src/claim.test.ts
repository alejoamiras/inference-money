import { beforeAll, describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { claim, registerSponsor, SponsorUnavailableError, waitClaimable } from "./claim"
import { type ClaimTicket, prepareDeposit } from "./deposit"
import { fakeWallet } from "./test/fake-wallet"
import { f, MANIFEST as M } from "./test/fixtures"

let recipient: AztecAddress
beforeAll(async () => {
	recipient = await AztecAddress.random()
})
const ticket = async (kind: "public" | "private"): Promise<ClaimTicket> => ({
	draft: await prepareDeposit({ amount: 5n, recipient, kind }, M, () => 1_000n),
	messageHash: f(0x77),
	leafIndex: 3n,
})
const fail = (message: string) => () => {
	throw new Error(message)
}

describe("registerSponsor", () => {
	const SPONSOR = "0x0628377e98bca5913dc86765ad0758f7b7aa83eac49079c6fba125807b393fe1" as const

	it("registers the pinned sponsor, and refuses a manifest naming any other", async () => {
		const registered: string[] = []
		const wallet = { registerContract: async (i: { address: { toString(): string } }) => void registered.push(i.address.toString()) }
		expect((await registerSponsor(wallet as never, { ...M, l2: { ...M.l2, sponsoredFpc: SPONSOR } })).toString()).toBe(SPONSOR)
		expect(registered).toEqual([SPONSOR])

		await expect(registerSponsor(wallet as never, M)).rejects.toBeInstanceOf(SponsorUnavailableError)
		expect(registered).toHaveLength(1)
	})
})

describe("claim", () => {
	it("pays a private claim through the sponsor and leaves a public one to the wallet", async () => {
		const priv = fakeWallet()
		expect(await claim(await ticket("private"), priv.wallet, M, { from: recipient })).toBe("claimed")
		expect(priv.sent[0]).toMatchObject({ calls: ["sponsor_unconditionally", "claim_private"], feePayer: M.l2.sponsoredFpc })

		const pub = fakeWallet()
		await claim(await ticket("public"), pub.wallet, M, { from: recipient })
		expect(pub.sent[0]).toMatchObject({ calls: ["claim_public"], feePayer: undefined })

		const chosen = fakeWallet()
		await claim(await ticket("private"), chosen.wallet, M, { from: recipient, fee: "wallet-default" })
		expect(chosen.sent[0]).toMatchObject({ calls: ["claim_private"], feePayer: undefined })
	})

	it("reports an already-consumed message instead of failing", async () => {
		const { wallet } = fakeWallet({ send: fail("Assertion failed: Message not in state: already nullified") })
		expect(await claim(await ticket("public"), wallet, M, { from: recipient })).toBe("already-consumed")
	})

	it("surfaces a sponsor that cannot pay, or is missing, as SponsorUnavailableError", async () => {
		const exhausted = fakeWallet({ send: fail("Not enough balance for fee payer to pay for transaction") })
		await expect(claim(await ticket("private"), exhausted.wallet, M, { from: recipient })).rejects.toBeInstanceOf(
			SponsorUnavailableError,
		)

		const none = fakeWallet()
		const noSponsor = { ...M, l2: { ...M.l2, sponsoredFpc: undefined } }
		await expect(claim(await ticket("private"), none.wallet, noSponsor, { from: recipient })).rejects.toBeInstanceOf(
			SponsorUnavailableError,
		)
		expect(none.sent).toHaveLength(0)

		const other = fakeWallet({ send: fail("boom") })
		await expect(claim(await ticket("public"), other.wallet, M, { from: recipient })).rejects.toThrow("boom")
	})
})

describe("waitClaimable", () => {
	const noSleep = async () => {}

	it("waits for the checkpoint, then for the wallet's anchor, then resolves", async () => {
		const checkpoints = [undefined, 7, 7]
		const node = { getL1ToL2MessageCheckpoint: async () => checkpoints.shift() }
		let sims = 0
		const { wallet } = fakeWallet({
			simulate: () => {
				if (sims++ === 0) throw new Error("Tried to consume nonexistent L1-to-L2 message")
			},
		})
		const stages: string[] = []
		await waitClaimable(await ticket("public"), node, wallet, M, recipient, (s) => stages.push(s), { sleep: noSleep })
		expect(stages).toEqual(["waiting-for-inclusion", "waiting-for-wallet-sync"])
	})

	it("rethrows an unexpected simulation error and gives up after its attempts", async () => {
		const node = { getL1ToL2MessageCheckpoint: async () => 7 }
		const broken = fakeWallet({ simulate: fail("Assertion failed: bridge is paused") })
		await expect(
			waitClaimable(await ticket("public"), node, broken.wallet, M, recipient, undefined, { sleep: noSleep }),
		).rejects.toThrow("paused")

		const never = { getL1ToL2MessageCheckpoint: async () => undefined }
		const { wallet } = fakeWallet()
		await expect(
			waitClaimable(await ticket("public"), never, wallet, M, recipient, undefined, { sleep: noSleep, attempts: 3 }),
		).rejects.toThrow(/not claimable yet/)
	})
})
