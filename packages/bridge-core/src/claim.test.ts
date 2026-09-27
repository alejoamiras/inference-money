import { beforeAll, describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Fr } from "@aztec/aztec.js/fields"
import { MerkleTreeId } from "@aztec/stdlib/trees"
import { claim, L2_DONE, type NullifierNode, registerSponsor, SponsorUnavailableError, waitClaimable } from "./claim"
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
const NO_NULLIFIER: NullifierNode = { findLeavesIndexes: async (_b, _t, leaves) => leaves.map(() => undefined) }

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
		expect(await claim(await ticket("private"), NO_NULLIFIER, priv.wallet, M, { from: recipient })).toBe("claimed")
		expect(priv.sent[0]).toMatchObject({ calls: ["sponsor_unconditionally", "claim_private"], feePayer: M.l2.sponsoredFpc })
		expect(priv.sent[0]?.wait, "answered only once checkpointed, never at a proposed block").toEqual(L2_DONE)

		const pub = fakeWallet()
		await claim(await ticket("public"), NO_NULLIFIER, pub.wallet, M, { from: recipient })
		expect(pub.sent[0]).toMatchObject({ calls: ["claim_public"], feePayer: undefined })

		const chosen = fakeWallet()
		await claim(await ticket("private"), NO_NULLIFIER, chosen.wallet, M, { from: recipient, fee: "wallet-default" })
		expect(chosen.sent[0]).toMatchObject({ calls: ["claim_private"], feePayer: undefined })

		const sponsoredPublic = fakeWallet()
		await claim(await ticket("public"), NO_NULLIFIER, sponsoredPublic.wallet, M, { from: recipient, fee: "sponsored" })
		expect(sponsoredPublic.sent[0]).toMatchObject({ calls: ["sponsor_unconditionally", "claim_public"], feePayer: M.l2.sponsoredFpc })
	})

	it("reports already-consumed only when this ticket's nullifier is on L2; any other nullifier error stays retryable", async () => {
		for (const kind of ["public", "private"] as const) {
			const t = await ticket(kind)
			const { wallet } = fakeWallet({ send: fail("Assertion failed: L1-to-L2 message is already nullified") })
			const queried: Fr[] = []
			const nullified: NullifierNode = {
				findLeavesIndexes: async (block, tree, leaves) => {
					expect(block, "a proposed nullifier can still be re-orged out").toBe("checkpointed")
					expect(tree).toBe(MerkleTreeId.NULLIFIER_TREE)
					queried.push(...leaves)
					return leaves.map(() => ({ data: 7n }) as never)
				},
			}
			expect(await claim(t, nullified, wallet, M, { from: recipient })).toBe("already-consumed")
			await expect(claim(t, NO_NULLIFIER, wallet, M, { from: recipient })).rejects.toThrow("already nullified")
			const unreachable: NullifierNode = { findLeavesIndexes: fail("503") as never }
			await expect(claim(t, unreachable, wallet, M, { from: recipient })).rejects.toThrow("already nullified")
			expect(queried).toHaveLength(1)
		}
	})

	it("surfaces a sponsor that cannot pay, or is missing, as SponsorUnavailableError", async () => {
		const exhausted = fakeWallet({ send: fail("Not enough balance for fee payer to pay for transaction") })
		await expect(claim(await ticket("private"), NO_NULLIFIER, exhausted.wallet, M, { from: recipient })).rejects.toBeInstanceOf(
			SponsorUnavailableError,
		)

		const none = fakeWallet()
		const noSponsor = { ...M, l2: { ...M.l2, sponsoredFpc: undefined } }
		await expect(claim(await ticket("private"), NO_NULLIFIER, none.wallet, noSponsor, { from: recipient })).rejects.toBeInstanceOf(
			SponsorUnavailableError,
		)
		expect(none.sent).toHaveLength(0)

		const other = fakeWallet({ send: fail("boom") })
		await expect(claim(await ticket("public"), NO_NULLIFIER, other.wallet, M, { from: recipient })).rejects.toThrow("boom")
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
