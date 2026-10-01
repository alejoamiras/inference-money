import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import {
	type BridgeManifest,
	type ClaimTicket,
	decodeClaimTicket,
	decodeDepositDraft,
	encodeTicket,
	exitToL1,
	type ListOptions,
	openRequest,
	payRequest,
	reconcileDeposit,
	syncMerchantList,
} from "@inference-money/bridge-core"
import {
	aztecWorld,
	castClaim,
	castDeposit,
	type DemoL1,
	type DemoSession,
	demoL1,
	depositWorld,
	HIDDEN,
	l1CtxOf,
	MERCHANTS,
	type Merchant,
	sendPrivate,
	sponsoredFee,
	type Tour,
	type TourStepId,
	totalSupplySlot,
	type User,
	usdcOf,
} from "@inference-money/demo"
import type { Tickets } from "@/demo/tickets"
import type { DemoWallet } from "@/demo/wallet"
import { type Explorer, type FeedRow, PUBLIC_TEXT, rowOf } from "@/tour/player"
import { HOLDER_NAME } from "@/ui/cards"
import { usdc2 } from "@/ui/format"
import type { Stage } from "@/ui/Verdict"
import type { LiveAction, ValidDraft } from "./draft"
import { classify, type Outcome } from "./outcome"

export interface LiveCtx {
	demo: DemoWallet
	m: BridgeManifest
	l1RpcUrl: string
	tickets: Tickets
	tour: Tour
	explorer: Explorer | undefined
	/** Requests opened and not paid yet, by `payee>payer`: a payment uses one before opening its own. */
	requests: Map<string, Fr>
}

export type Report = (stage: Stage, detail?: string) => void

type TxKind = keyof typeof HIDDEN

/** About what a deposit and its approval cost on Ethereum in gas; below it, the lane replays. */
const MIN_GAS_WEI = 10n ** 15n
const DUPLICATE_NULLIFIER = /Existing nullifier|Duplicate nullifier/i

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const session = (ctx: LiveCtx): DemoSession => ({ wallet: ctx.demo.wallet, node: ctx.demo.node, m: ctx.m })
const token = (ctx: LiveCtx) => AztecAddress.fromStringUnsafe(ctx.m.l2.token.address)
const address = (ctx: LiveCtx, who: ValidDraft["to"]) => ctx.demo.cast[who as User | Merchant].address
const isMerchant = (who: string): boolean => (MERCHANTS as readonly string[]).includes(who)

async function listOptions(ctx: LiveCtx): Promise<ListOptions> {
	return { list: await syncMerchantList(ctx.demo.node, token(ctx)), fee: sponsoredFee(ctx.m) }
}

/** The public rows of the txs this page sent since `since` and the node holds, decoded as the recording was. */
async function aztecRows(ctx: LiveCtx, since: number, kinds: readonly TxKind[]): Promise<FeedRow[]> {
	const slot = await totalSupplySlot(ctx.m)
	const rows: FeedRow[] = []
	for (const [i, s] of ctx.demo.sent.slice(since).entries()) {
		const kind = kinds[Math.min(i, kinds.length - 1)] as TxKind
		const effect = await ctx.demo.node.getTxEffect(TxHash.fromString(s.hash))
		if (!effect) continue
		const items = aztecWorld(effect.data, { feePayer: s.feePayer, expiresAt: s.expiresAt }, [slot], HIDDEN[kind])
		const href = ctx.explorer && `${ctx.explorer.l2Tx}${s.hash}`
		rows.push({ key: s.hash, source: "live", chain: "aztec", text: PUBLIC_TEXT[kind], items, href })
	}
	return rows
}

/** The recorded step instead of a live one the demo cannot afford right now, said so in the verdict and the feed. */
export function replay(ctx: LiveCtx, step: TourStepId, why: string): Outcome {
	const recorded = ctx.tour.steps.find((s) => s.id === step)
	if (!recorded) return { kind: "failed", detail: why }
	return {
		kind: "settled",
		detail: `${why} This replays the recorded run instead, so nothing moved now.`,
		rows: [rowOf(recorded, ctx.explorer)],
	}
}

/** Why `signer` cannot pay for a deposit of `amount` now, or nothing when it can. */
async function shortfall(signer: DemoL1, m: BridgeManifest, amount: bigint): Promise<string | undefined> {
	const who = signer.account.address
	const [eth, usdc] = await Promise.all([signer.publicClient.getBalance({ address: who }), usdcOf(signer, m, who)])
	if (usdc < amount) return `This Ethereum wallet holds ${usdc2(usdc)} demo USDC, less than that.`
	if (eth < MIN_GAS_WEI) return "This Ethereum wallet has no gas money left."
	return undefined
}

async function deposit(ctx: LiveCtx, d: ValidDraft, report: Report): Promise<Outcome> {
	const user = d.actor as User
	const amount = d.amount as bigint
	const signer = demoL1(ctx.l1RpcUrl, ctx.m, user)
	const short = await shortfall(signer, ctx.m, amount)
	if (short) return user === "alice" ? replay(ctx, "deposit", short) : { kind: "failed", detail: short }
	const pending = { id: crypto.randomUUID(), user, since: Date.now() }
	const plan = { from: user, to: address(ctx, user), kind: "private", amount } as const
	const t = await castDeposit(
		session(ctx),
		signer,
		plan,
		undefined,
		(draft) => ctx.tickets.putDeposit({ ...pending, draft: encodeTicket("draft", draft) }),
		(stage) => report(stage === "confirming" ? "settle" : "send"),
	)
	ctx.tickets.putDeposit({ ...pending, claim: encodeTicket("claim", t) })
	const href = ctx.explorer && t.draft.l1TxHash && `${ctx.explorer.l1Tx}${t.draft.l1TxHash}`
	const row: FeedRow = { key: t.messageHash, source: "live", chain: "ethereum", text: PUBLIC_TEXT.deposit, items: depositWorld(t), href }
	return { kind: "settled", detail: `Deposited. ${HOLDER_NAME[user]} can claim it once the message reaches Aztec.`, rows: [row] }
}

const NOTHING_TO_CLAIM = "There is nothing to claim: deposit first."

/** The oldest deposit of `user`'s this page sent, as a claim ticket; a string says why there is none to claim. */
async function claimable(ctx: LiveCtx, user: User): Promise<{ id: string; ticket: ClaimTicket } | string> {
	const p = ctx.tickets.deposits().find((x) => x.user === user)
	if (!p) return NOTHING_TO_CLAIM
	if (p.claim) return { id: p.id, ticket: decodeClaimTicket(p.claim) }
	if (!p.draft) return NOTHING_TO_CLAIM
	const found = await reconcileDeposit(decodeDepositDraft(p.draft), l1CtxOf(demoL1(ctx.l1RpcUrl, ctx.m, user)), ctx.m)
	if (found === "pending") return "That deposit is still confirming on Ethereum; try again in a minute."
	if (found === "not-deposited") {
		ctx.tickets.dropDeposit(p.id)
		return "That deposit never reached Ethereum; deposit again."
	}
	ctx.tickets.putDeposit({ ...p, draft: undefined, claim: encodeTicket("claim", found) })
	return { id: p.id, ticket: found }
}

async function claimDeposit(ctx: LiveCtx, d: ValidDraft, report: Report): Promise<Outcome> {
	const user = d.actor as User
	const found = await claimable(ctx, user)
	// The recording has alice's claim only; a deposit of this page's still on its way is waited for, never replayed over.
	if (found === NOTHING_TO_CLAIM && user === "alice") return replay(ctx, "claim", found)
	if (typeof found === "string") return { kind: "failed", detail: found }
	const since = ctx.demo.sent.length
	await castClaim(session(ctx), found.ticket, () => report("simulate", "Waiting for the deposit's message to reach Aztec."))
	ctx.tickets.dropDeposit(found.id)
	const amount = usdc2(found.ticket.draft.intent.amount)
	return { kind: "settled", detail: `${HOLDER_NAME[user]} claimed ${amount} USDC.`, rows: await aztecRows(ctx, since, ["claim"]) }
}

async function request(ctx: LiveCtx, d: ValidDraft): Promise<Outcome> {
	const since = ctx.demo.sent.length
	const from = address(ctx, d.actor)
	const opened = await openRequest(
		ctx.demo.wallet,
		ctx.demo.node,
		token(ctx),
		{ from, to: from, completer: address(ctx, d.to) },
		await listOptions(ctx),
	)
	ctx.requests.set(`${d.actor}>${d.to}`, opened.commitment)
	const detail = `${HOLDER_NAME[d.actor]} opened a request only ${HOLDER_NAME[d.to]} can pay.`
	return { kind: "settled", detail, rows: await aztecRows(ctx, since, ["request"]) }
}

/**
 * Pays a merchant through a request it opened for the payer, as its server would, reusing one already open. A user
 * cannot open a stamped request, so paying a user pays into one made without the merchant list, which the rules refuse.
 */
async function pay(ctx: LiveCtx, d: ValidDraft): Promise<Outcome> {
	const since = ctx.demo.sent.length
	const key = `${d.to}>${d.actor}`
	const opts = await listOptions(ctx)
	let commitment = ctx.requests.get(key)
	if (!commitment && isMerchant(d.to)) {
		const merchant = address(ctx, d.to)
		const intent = { from: merchant, to: merchant, completer: address(ctx, d.actor) }
		commitment = (await openRequest(ctx.demo.wallet, ctx.demo.node, token(ctx), intent, opts)).commitment
		ctx.requests.set(key, commitment)
	}
	const payment = {
		from: address(ctx, d.actor),
		commitment: commitment ?? Fr.random(),
		amount: d.amount as bigint,
		kind: "private",
	} as const
	await payRequest(ctx.demo.gate, ctx.demo.wallet, token(ctx), payment, opts)
	ctx.requests.delete(key)
	const kinds: TxKind[] = ctx.demo.sent.length - since > 1 ? ["request", "pay"] : ["pay"]
	const detail = `${HOLDER_NAME[d.actor]} paid ${usdc2(payment.amount)} USDC into ${HOLDER_NAME[d.to]}'s request.`
	return { kind: "settled", detail, rows: await aztecRows(ctx, since, kinds) }
}

async function send(ctx: LiveCtx, d: ValidDraft): Promise<Outcome> {
	const since = ctx.demo.sent.length
	const amount = d.amount as bigint
	await sendPrivate(session(ctx), address(ctx, d.actor), address(ctx, d.to), amount)
	const detail = `${HOLDER_NAME[d.actor]} sent ${HOLDER_NAME[d.to]} ${usdc2(amount)} USDC.`
	return { kind: "settled", detail, rows: await aztecRows(ctx, since, ["transfer"]) }
}

/**
 * A merchant's exit may go anywhere, its merchant status proven at the anchor block; a user's goes only to its funding
 * address, which bridge-core checks before any witness or burn.
 */
async function withdraw(ctx: LiveCtx, d: ValidDraft, wallets: Record<"A_demo" | "B_demo", `0x${string}`>): Promise<Outcome> {
	const since = ctx.demo.sent.length
	const amount = d.amount as bigint
	const recipientL1 = wallets[d.to as "A_demo" | "B_demo"]
	const exit = { kind: "private", from: address(ctx, d.actor), recipientL1, amount, asMerchant: isMerchant(d.actor) } as const
	const ticket = await exitToL1(exit, ctx.demo.wallet, ctx.demo.node, ctx.m)
	ctx.tickets.putExit({ id: crypto.randomUUID(), actor: d.actor, since: Date.now(), ticket: encodeTicket("exit", ticket) })
	const detail = `Burned on Aztec. The ${usdc2(amount)} USDC pays out to ${HOLDER_NAME[d.to]} once Ethereum accepts this block's proof; this page sends it then.`
	return { kind: "settled", detail, rows: await aztecRows(ctx, since, ["exit"]) }
}

async function landed(ctx: LiveCtx, hash: string): Promise<boolean> {
	const receipt = await ctx.demo.node.getTxReceipt(TxHash.fromString(hash))
	return receipt.isMined() && receipt.hasExecutionSucceeded()
}

/**
 * On a duplicate nullifier, first checks this attempt's own last send: if it landed, the action went through. Else
 * another tx spent the same note first, which the wallet's sync before the next send resolves, so it runs once more.
 */
export async function withConflictRetry(ctx: LiveCtx, attempt: () => Promise<Outcome>, kinds: readonly TxKind[]): Promise<Outcome> {
	const since = ctx.demo.sent.length
	try {
		return await attempt()
	} catch (e) {
		if (!DUPLICATE_NULLIFIER.test(message(e))) throw e
		const own = ctx.demo.sent.length > since ? ctx.demo.sent.at(-1) : undefined
		if (own && (await landed(ctx, own.hash))) {
			return { kind: "settled", detail: "It went through: the network had it already.", rows: await aztecRows(ctx, since, kinds) }
		}
		return attempt()
	}
}

const KINDS: Record<LiveAction, readonly TxKind[]> = {
	deposit: [],
	claim: ["claim"],
	request: ["request"],
	pay: ["request", "pay"],
	send: ["transfer"],
	withdraw: ["exit"],
}

/**
 * Runs a draft live: refusals come back with the contract's rule text before anything is proven or sent; an Ethereum
 * step the demo wallet cannot afford, or a claim with nothing to claim, replays the recording and says so.
 */
export async function runDraft(
	ctx: LiveCtx,
	d: ValidDraft,
	wallets: Record<"A_demo" | "B_demo", `0x${string}`>,
	report: Report,
): Promise<Outcome> {
	report("simulate")
	const run: Record<LiveAction, () => Promise<Outcome>> = {
		deposit: () => deposit(ctx, d, report),
		claim: () => claimDeposit(ctx, d, report),
		request: () => request(ctx, d),
		pay: () => pay(ctx, d),
		send: () => send(ctx, d),
		withdraw: () => withdraw(ctx, d, wallets),
	}
	try {
		return await withConflictRetry(ctx, run[d.action], KINDS[d.action])
	} catch (e) {
		return classify(e, d)
	}
}
