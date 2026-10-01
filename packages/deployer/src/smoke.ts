import { writeFileSync } from "node:fs"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { waitForTx } from "@aztec-labs/aztec.js/node"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import {
	assertNetworkIdentity,
	bridgeRefusalOf,
	completionCount,
	type DepositDraft,
	decodeClaimTicket,
	decodeDepositDraft,
	decodeExitTicket,
	encodeTicket,
	exitTicketFromTx,
	exitToL1,
	finishWithdrawal,
	isExitWithdrawn,
	L2_DONE,
	l2UsdcBalance,
	openRequest,
	outboxReader,
	payRequest,
	syncMerchantList,
	tokenRefusalOf,
} from "@inference-money/bridge-core"
import { aztecWorld, ethereumWorld, parseTour, SMOKE_AMOUNTS, type TourStep, totalSupplySlot, tourHeader } from "@inference-money/demo"
import type { Hex } from "viem"
import { tokenOf } from "./admin"
import { usersTagOf } from "./demo"
import { castClaim, castDeposit, enlist, type Log, type Player, sendPrivate, sponsored, withHeartbeat } from "./demo-flows"
import { demoSigner, l1Ctx, usdcOf } from "./demo-l1"
import type { L1Signer } from "./l1"
import { type StateDir, withStateDir } from "./run-state"
import { type ManifestRef, type Session, withSession } from "./session"
import type { SentTx } from "./wallet"

export const SMOKE_STEPS = ["deposit", "claim", "request", "pay", "refund", "transfer-refused", "exit-refused", "exit", "withdraw"] as const
export type SmokeStep = (typeof SMOKE_STEPS)[number]

const A = SMOKE_AMOUNTS
const usdc = (v: bigint) => v.toString()

/** Each step as the tour tells it; `hidden` names what its Aztec tx carries that nobody else can read. */
const STORY: Record<SmokeStep, Pick<TourStep, "actor" | "action" | "to" | "amount"> & { hidden?: string[] }> = {
	deposit: { actor: "A_demo", action: "deposit", to: "alice", amount: usdc(A.deposit) },
	claim: { actor: "alice", action: "claim", to: "alice", amount: usdc(A.deposit), hidden: ["recipient"] },
	request: { actor: "galactica", action: "request", to: "galactica", amount: usdc(A.deposit), hidden: ["recipient", "payer"] },
	pay: { actor: "alice", action: "pay", to: "galactica", amount: usdc(A.deposit), hidden: ["payer", "recipient", "amount"] },
	refund: { actor: "galactica", action: "refund", to: "alice", amount: usdc(A.refund), hidden: ["sender", "recipient", "amount"] },
	"transfer-refused": { actor: "alice", action: "transfer", to: "bob", amount: usdc(A.refused) },
	"exit-refused": { actor: "alice", action: "exit", to: "B_demo", amount: usdc(A.refused) },
	exit: { actor: "alice", action: "exit", to: "A_demo", amount: usdc(A.exit), hidden: ["sender"] },
	withdraw: { actor: "A_demo", action: "withdraw", to: "A_demo", amount: usdc(A.exit) },
}

type Balances = Record<"alice" | "galactica" | "aDemo" | "portal", bigint>

/** What a run moves: alice pays all she deposited, and withdraws what galactica refunded. */
export const EXPECTED_DELTAS: Balances = {
	alice: A.refund - A.exit,
	galactica: A.deposit - A.refund,
	aDemo: A.exit - A.deposit,
	portal: A.deposit - A.exit,
}

/** A step's L2 tx as it went to the node: enough to settle it after a crash, and to tell what the world sees. */
interface Journaled {
	step: SmokeStep
	hash: string
	feePayer: string
	expiresAt: string
}

/** Owner-only, per deployment: everything an interrupted run resumes from, the deposit's secret included. */
export interface SmokeState {
	baseline: Record<keyof Balances, string>
	done: SmokeStep[]
	draft?: string
	claim?: string
	commitment?: string
	exit?: string
	/** The last L2 tx a step sent: a step that finds its own here settles it instead of sending again. */
	sent?: Journaled
	tour: Partial<Record<SmokeStep, TourStep>>
}

const STATE = "smoke.json"
const WITHDRAWABLE = { timeoutMs: 3 * 60 * 60_000 }

interface Run {
	s: Session
	dir: StateDir
	state: SmokeState
	cast: Record<"alice" | "bob" | "galactica", Player>
	aDemo: L1Signer
	bDemo: L1Signer
	log: Log
}

const save = (r: Run) => r.dir.write(STATE, r.state)
const nextStep = (state: SmokeState) => SMOKE_STEPS.find((s) => !state.done.includes(s))
const tokenAddress = (r: Run) => tokenOf(r.s.wallet, r.s.m).address
const outbox = (r: Run) => outboxReader(r.aDemo.publicClient, r.s.m.l1.outbox)

async function balances(r: Pick<Run, "s" | "cast" | "aDemo">): Promise<Balances> {
	const priv = (p: Player) => l2UsdcBalance(r.s.wallet, r.s.m, p.address, "private")
	const [alice, galactica, aDemo, portal] = await Promise.all([
		priv(r.cast.alice),
		priv(r.cast.galactica),
		usdcOf(r.aDemo, r.s.m, r.aDemo.account.address),
		usdcOf(r.aDemo, r.s.m, r.s.m.l1.portal),
	])
	return { alice, galactica, aDemo, portal }
}

/** The step's tour entry from the tx the journal recorded for it. */
async function aztecEntry(r: Run, step: SmokeStep): Promise<TourStep> {
	const j = r.state.sent
	if (j?.step !== step) throw new Error(`the ${step} step ended without the journal seeing its tx`)
	const effect = await r.s.node.getTxEffect(TxHash.fromString(j.hash))
	if (!effect) throw new Error(`the node has no effect for the ${step} tx ${j.hash}`)
	const { hidden = [], ...story } = STORY[step]
	const committed = { feePayer: j.feePayer, expiresAt: BigInt(j.expiresAt) }
	const world = aztecWorld(effect.data, committed, [await totalSupplySlot(r.s.m)], hidden)
	const l2 = { txHash: j.hash, block: Number(effect.l2BlockNumber), expiration: Number(j.expiresAt) }
	return { id: step, ...story, verdict: "settled", l2, world }
}

async function ethereumEntry(r: Run, step: SmokeStep, hash: Hex | undefined, fields: [string, string][]): Promise<TourStep> {
	const entry: TourStep = { id: step, ...STORY[step], verdict: "settled", world: ethereumWorld(fields) }
	if (!hash) return entry
	const receipt = await r.aDemo.publicClient.getTransactionReceipt({ hash })
	return { ...entry, l1: { txHash: hash, block: Number(receipt.blockNumber) } }
}

/** Runs `attempt`, which must be refused with `rule` before anything reaches the node. */
async function refusedEntry(
	r: Run,
	step: SmokeStep,
	rule: string,
	ruleOf: (e: unknown) => string | undefined,
	attempt: () => Promise<unknown>,
) {
	const before = r.s.sent.length
	const outcome = await attempt().then(
		() => "no refusal",
		(e: unknown) => ruleOf(e) ?? `another failure: ${e instanceof Error ? e.message : String(e)}`,
	)
	if (outcome !== rule) throw new Error(`${step}: expected the ${rule} refusal, got ${outcome}`)
	if (r.s.sent.length !== before) throw new Error(`${step}: the refused attempt reached the node`)
	const entry: TourStep = { id: step, ...STORY[step], verdict: "refused", rule, world: [] }
	return entry
}

const STEPS: Record<SmokeStep, (r: Run) => Promise<TourStep>> = {
	deposit: async (r) => {
		const persist = (d: DepositDraft) => {
			r.state.draft = encodeTicket("draft", d)
			save(r)
		}
		const prior = r.state.draft ? decodeDepositDraft(r.state.draft) : undefined
		const plan = { from: "alice", to: r.cast.alice.address, kind: "private", amount: A.deposit } as const
		const t = await castDeposit(r.s, plan, prior, persist)
		r.state.claim = encodeTicket("claim", t)
		return ethereumEntry(r, "deposit", t.draft.l1TxHash, [
			["depositor", t.depositor],
			["amount", usdc(t.draft.intent.amount)],
			["kind", "private"],
			["secret hash", t.draft.secretHash.toString()],
			["message index", t.leafIndex.toString()],
		])
	},
	claim: async (r) => {
		if (!r.state.claim) throw new Error("no claim ticket stored")
		await castClaim(r.s, decodeClaimTicket(r.state.claim), r.log)
		return aztecEntry(r, "claim")
	},
	request: async (r) => {
		const { alice, galactica } = r.cast
		const list = await syncMerchantList(r.s.node, tokenAddress(r))
		const intent = { from: galactica.address, to: galactica.address, completer: alice.address }
		const { commitment } = await openRequest(r.s.wallet, r.s.node, tokenAddress(r), intent, { list, fee: sponsored(r.s) })
		r.state.commitment = commitment.toString()
		return aztecEntry(r, "request")
	},
	pay: async (r) => {
		if (!r.state.commitment) throw new Error("no request stored")
		const commitment = Fr.fromHexString(r.state.commitment)
		const list = await syncMerchantList(r.s.node, tokenAddress(r))
		const p = { from: r.cast.alice.address, commitment, amount: A.deposit, kind: "private" } as const
		await payRequest(r.s.gate, r.s.wallet, tokenAddress(r), p, { list, fee: sponsored(r.s) })
		if ((await completionCount(r.s.node, tokenAddress(r), commitment)) !== 1)
			throw new Error("the request is not completed exactly once")
		return aztecEntry(r, "pay")
	},
	refund: async (r) => {
		await sendPrivate(r.s, r.cast.galactica.address, r.cast.alice.address, A.refund)
		return aztecEntry(r, "refund")
	},
	"transfer-refused": (r) => {
		const { alice, bob } = r.cast
		const transfer = tokenOf(r.s.wallet, r.s.m).methods.transfer_private_to_private!(alice.address, bob.address, A.refused, 0)
		return refusedEntry(r, "transfer-refused", "transfer", tokenRefusalOf, () =>
			transfer.simulate({ from: alice.address, fee: sponsored(r.s) }),
		)
	},
	"exit-refused": (r) => {
		// asMerchant skips the SDK's own destination check, so the refusal shown is the bridge's.
		const e = {
			kind: "private",
			from: r.cast.alice.address,
			recipientL1: r.bDemo.account.address,
			amount: A.refused,
			asMerchant: true,
		} as const
		return refusedEntry(r, "exit-refused", "exitDestination", bridgeRefusalOf, () => exitToL1(e, r.s.wallet, r.s.node, r.s.m))
	},
	exit: async (r) => {
		const e = { kind: "private", from: r.cast.alice.address, recipientL1: r.aDemo.account.address, amount: A.exit } as const
		r.state.exit = encodeTicket("exit", await exitToL1(e, r.s.wallet, r.s.node, r.s.m))
		return aztecEntry(r, "exit")
	},
	withdraw: async (r) => {
		if (!r.state.exit) throw new Error("no exit ticket stored")
		const t = decodeExitTicket(r.state.exit)
		let hash: Hex | undefined
		if (await isExitWithdrawn(t, r.s.node, outbox(r))) r.log("  an earlier run completed the withdrawal; its L1 tx is not on record")
		else hash = await finishWithdrawal(t, r.s.node, outbox(r), l1Ctx(r.aDemo), r.s.m, (st) => r.log(`  withdraw: ${st}`), WITHDRAWABLE)
		return ethereumEntry(r, "withdraw", hash, [
			["recipient", t.recipient],
			["amount", usdc(t.amount)],
		])
	},
}

/** "landed" once checkpointed without a revert; "gone" once the node reports it dropped, or it reverted. */
async function fateOf(s: Session, j: Journaled): Promise<"landed" | "gone"> {
	const hash = TxHash.fromString(j.hash)
	if ((await s.node.getTxReceipt(hash)).isDropped()) return "gone"
	const receipt = await waitForTx(s.node, hash, { ...L2_DONE, dontThrowOnRevert: true })
	return receipt.hasExecutionSucceeded() ? "landed" : "gone"
}

/**
 * Settles a step whose tx went out before a crash: a landed one is done (an exit rebuilds its ticket from the tx), a
 * gone one runs again. A request's commitment cannot be read back from its tx, so an unfinished request is opened
 * anew, as is the request of a lost payment: the payment gate refuses that commitment until the lost tx expires.
 */
async function settleJournal(r: Run, step: SmokeStep): Promise<TourStep | undefined> {
	const j = r.state.sent
	if (j?.step !== step || !STORY[step].hidden || step === "request") return undefined
	if ((await fateOf(r.s, j)) === "gone") {
		delete r.state.sent
		if (step === "pay") r.state.done = r.state.done.filter((d) => d !== "request")
		save(r)
		return undefined
	}
	if (step === "exit") {
		const t = await exitTicketFromTx(TxHash.fromString(j.hash), r.aDemo.account.address, A.exit, r.s.node, outbox(r), r.s.m)
		if (typeof t === "string") throw new Error(`the exit ${j.hash} landed, but its withdrawal is ${t}`)
		r.state.exit = encodeTicket("exit", t)
	}
	return aztecEntry(r, step)
}

async function runSteps(r: Run): Promise<void> {
	for (let step = nextStep(r.state); step; step = nextStep(r.state)) {
		r.log(`${step}…`)
		const entry = (await settleJournal(r, step)) ?? (await STEPS[step](r))
		r.state.tour[step] = entry
		r.state.done.push(step)
		save(r)
		r.log(`${step}: ${entry.verdict} ${entry.l2?.txHash ?? entry.l1?.txHash ?? entry.rule ?? ""}`)
	}
}

export function assertDeltas(baseline: SmokeState["baseline"], now: Balances): void {
	const moved = (k: keyof Balances) => now[k] - BigInt(baseline[k])
	const wrong = (Object.keys(EXPECTED_DELTAS) as (keyof Balances)[]).filter((k) => moved(k) !== EXPECTED_DELTAS[k])
	if (wrong.length === 0) return
	const lines = wrong.map((k) => `${k} moved ${moved(k)}, expected ${EXPECTED_DELTAS[k]}`)
	throw new Error(`The run's deltas are off (as they are when anyone else moves the cast's funds meanwhile): ${lines.join("; ")}`)
}

const asStrings = (b: Balances) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()])) as SmokeState["baseline"]

function writeTour(path: string, r: Run): void {
	const tour = parseTour({ ...tourHeader(r.s.m), steps: SMOKE_STEPS.map((step) => r.state.tour[step]) })
	writeFileSync(path, `${JSON.stringify(tour, null, "\t")}\n`)
	r.log(`tour written to ${path}`)
}

async function startRun(s: Session, dir: StateDir, tag: string, log: Log): Promise<Run> {
	const rpc = s.endpoints.l1RpcUrl
	const aDemo = demoSigner(rpc, s.m, "alice")
	await assertNetworkIdentity(s.node, aDemo.publicClient, s.m)
	const cast = await enlist(s, ["alice", "bob", "galactica"] as const, tag)
	const stored = dir.read<SmokeState>(STATE)
	const state = stored ?? { baseline: asStrings(await balances({ s, cast, aDemo })), done: [], tour: {} }
	if (stored) log(`resuming the run at ${nextStep(stored) ?? "its checks"}`)
	const run: Run = { s, dir, state, cast, aDemo, bDemo: demoSigner(rpc, s.m, "bob"), log }
	save(run)
	return run
}

/**
 * The acceptance run with the demo cast, keyless: A_demo deposits privately to alice, who claims, pays galactica's
 * request, gets a refund, is refused a transfer to bob and an exit to B_demo, and withdraws to A_demo. Every step is
 * journaled in an owner-only state dir per deployment, so an interrupted run resumes where it stopped, and the run
 * asserts deltas from its own start, so a repeat run on the same cast passes too. `record` writes the tour.
 */
export function smoke(ref: ManifestRef, opts: { record?: string; log: Log }): Promise<void> {
	const tag = usersTagOf(ref)
	return withStateDir("smoke", ref.m.l2.bridge.address, async (dir) => {
		let live: Run | undefined
		const onSend = (tx: SentTx) => {
			const step = live && nextStep(live.state)
			if (!live || !step) return
			live.state.sent = { step, hash: tx.hash, feePayer: tx.feePayer, expiresAt: tx.expiresAt.toString() }
			save(live)
		}
		await withSession(ref, { payments: dir.paymentStore(), onSend }, (s) =>
			withHeartbeat(s, async () => {
				const run = await startRun(s, dir, tag, opts.log)
				live = run
				await runSteps(run)
				live = undefined
				try {
					assertDeltas(run.state.baseline, await balances(run))
				} finally {
					dir.remove(STATE)
					dir.remove("payments.json")
				}
				if (opts.record) writeTour(opts.record, run)
				opts.log("smoke passed: every step settled or was refused as expected, and the balances moved as they should")
			}),
		)
	})
}
