import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { createAztecNodeClient, waitForTx } from "@aztec-labs/aztec.js/node"
import type { TxHash } from "@aztec-labs/aztec.js/tx"
import {
	type ClaimTicket,
	claim,
	confirmDeposit,
	type DepositDraft,
	type DepositKind,
	isClaimConsumed,
	L2_DONE,
	prepareDeposit,
	reconcileDeposit,
	registerSponsor,
	sponsoredPayment,
	submitDeposit,
	syncMerchantList,
	transferPrivate,
	waitClaimable,
} from "@inference-money/bridge-core"
import { type Actor, type CastMember, castMember, type User } from "@inference-money/demo"
import { tokenOf } from "./admin"
import { approvePermit2, demoSigner, l1Ctx } from "./demo-l1"
import { ensureAccount } from "./deploy-l2"
import { startBlockHeartbeat } from "./local-actors"
import { accountFor, type Session } from "./session"
import { openBridgeWallet } from "./wallet"

export type Log = (m: string) => void

/**
 * On local, a command that consumes an L1→L2 message beats its own blocks, since none come without traffic. The beats
 * come from a second wallet, so the session's record of what it sent holds only its own txs.
 */
export async function withHeartbeat<T>(s: Session, fn: () => Promise<T>): Promise<T> {
	if (s.m.network !== "local") return fn()
	const wallet = await openBridgeWallet(createAztecNodeClient(s.endpoints.nodeUrl), { prove: false })
	try {
		await registerSponsor(wallet, s.m)
		const stop = await startBlockHeartbeat(wallet, s.m)
		try {
			return await fn()
		} finally {
			await stop()
		}
	} finally {
		await wallet.stop()
	}
}

/** A cast member registered in a session's wallet, which can therefore sign as it. */
export interface Player extends CastMember {
	address: AztecAddress
}

/** Users' secrets derive from the users' tag, so enlisting one needs it. */
export async function enlist<A extends Actor>(s: Session, actors: readonly A[], tag?: string): Promise<Record<A, Player>> {
	const players = {} as Record<A, Player>
	for (const actor of actors) {
		const member = castMember(s.m, actor, tag)
		players[actor] = { ...member, address: await accountFor(s.wallet, member.secret) }
	}
	return players
}

export async function deployPlayers(s: Session, players: readonly Player[], log: Log): Promise<void> {
	const fees = { accountDeploy: async () => sponsoredPayment(s.m) }
	for (const p of players) await ensureAccount(s.wallet, p.secret, fees, log, p.actor)
}

export const sponsored = (s: Session) => ({ paymentMethod: sponsoredPayment(s.m) })

const CLAIMABLE = { pollMs: 5_000, attempts: 720 }

export interface DepositPlan {
	/** A_demo (alice's) or B_demo (bob's). */
	from: User
	to: AztecAddress
	kind: DepositKind
	amount: bigint
}

/**
 * Deposits from a demo Ethereum account, handing the draft to `persist` once it may be broadcast, so a crash after that
 * point recovers it (`prior`) instead of depositing twice. A prior draft that provably never landed is deposited anew.
 */
export async function castDeposit(
	s: Session,
	p: DepositPlan,
	prior: DepositDraft | undefined,
	persist: (d: DepositDraft) => void,
): Promise<ClaimTicket> {
	const signer = demoSigner(s.endpoints.l1RpcUrl, s.m, p.from)
	const l1 = l1Ctx(signer)
	if (prior) {
		const found = await reconcileDeposit(prior, l1, s.m)
		if (found === "pending") throw new Error("A stored deposit is not readable on Ethereum yet; rerun in a few minutes.")
		if (found !== "not-deposited") return found
	}
	await approvePermit2(signer, s.m, p.amount)
	const tip = (await l1.publicClient.getBlock()).timestamp
	const d = await prepareDeposit({ amount: p.amount, recipient: p.to, kind: p.kind }, s.m, () => tip)
	await submitDeposit(d, l1, s.m, s.node, (stage) => stage === "depositing" && persist(d))
	return confirmDeposit(d, l1, s.m)
}

/**
 * Claims `t` once its message is consumable, as its recipient (a private claim must be; a public one goes through the
 * sponsor). "already" when its message was consumed before, by this claim or anyone's.
 */
export async function castClaim(s: Session, t: ClaimTicket, log: Log): Promise<"claimed" | "already"> {
	if (await isClaimConsumed(t, s.node, s.m)) return "already"
	const from = t.draft.intent.recipient
	await waitClaimable(t, s.node, s.wallet, s.m, from, (w) => log(`  ${w}`), CLAIMABLE)
	const result = await claim(t, s.node, s.wallet, s.m, { from, fee: "sponsored" })
	return result === "claimed" ? "claimed" : "already"
}

/**
 * A private transfer with the side capsule the merchant list implies. User to user is refused before anything is
 * proven, with the token's own refusal text.
 */
export async function sendPrivate(s: Session, from: AztecAddress, to: AztecAddress, amount: bigint): Promise<TxHash> {
	const token = tokenOf(s.wallet, s.m).address
	const list = await syncMerchantList(s.node, token)
	const txHash = await transferPrivate(s.wallet, token, { from, to, amount }, { list, fee: sponsored(s) })
	await waitForTx(s.node, txHash, L2_DONE)
	return txHash
}
