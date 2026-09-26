import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import type { FeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { type AztecNode, createAztecNodeClient } from "@aztec/aztec.js/node"
import { FeeJuiceContract } from "@aztec/aztec.js/protocol"
import { TxHash } from "@aztec/aztec.js/tx"
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils"
import type { EmbeddedWallet } from "@aztec/wallets/embedded"
import {
	assertNetworkIdentity,
	type BridgeManifest,
	claim,
	confirmDeposit,
	type DepositKind,
	type ExitTicket,
	ensurePermit2Allowance,
	exitTicketFromTx,
	exitToL1,
	finishWithdrawal,
	type L1Ctx,
	type OutboxReader,
	outboxReader,
	prepareDeposit,
	registerBridgeContracts,
	registerSponsor,
	submitDeposit,
	tokenArtifact,
	waitClaimable,
} from "@inference-money/bridge-core"
import { type Address, erc20Abi, maxUint256 } from "viem"
import { signingKeyFor } from "./deploy-l2"
import { bridgeFeeJuice } from "./fee-juice"
import { readManifest } from "./manifest"
import { withOwnedTmpDir } from "./owned-tmp"
import { TESTNET_MANIFEST, type TestnetContext, testnetContext } from "./testnet"
import { openBridgeWallet, recordingNode, type SentTx } from "./wallet"

/** Exit tickets only (tx hash, recipient, amount): enough to finish a withdrawal, and no secret. */
export const SMOKE_STATE = join(homedir(), ".cache", "inference-money", "smoke", "testnet.json")
/** One USDC per leg: the smoke's per-leg ceiling is 1.25. */
export const LEG_AMOUNT = 1_000_000n
const SPONSOR_TOP_UP_FLOOR = 100n * 10n ** 18n
const PROVEN_TIMEOUT_MS = 90 * 60_000
const CLAIMABLE = { pollMs: 10_000, attempts: 360 }

interface Smoke {
	c: TestnetContext
	m: BridgeManifest
	node: AztecNode
	wallet: EmbeddedWallet
	sent: SentTx[]
	owner: AztecAddress
	l1: L1Ctx
	outbox: OutboxReader
	log: (m: string) => void
}

interface StoredExit {
	tx: string
	recipient: Address
	amount: string
	withdrawn: boolean
}
type SmokeState = Partial<Record<DepositKind, StoredExit>>

const readState = (): SmokeState => (existsSync(SMOKE_STATE) ? (JSON.parse(readFileSync(SMOKE_STATE, "utf8")) as SmokeState) : {})

function writeState(s: SmokeState): void {
	mkdirSync(dirname(SMOKE_STATE), { recursive: true, mode: 0o700 })
	const tmp = `${SMOKE_STATE}.${process.pid}.tmp`
	writeFileSync(tmp, `${JSON.stringify(s, null, "\t")}\n`)
	renameSync(tmp, SMOKE_STATE)
}

async function sentDuring<T>(s: Smoke, fn: () => Promise<T>): Promise<{ result: T; txs: SentTx[] }> {
	const from = s.sent.length
	const result = await fn()
	return { result, txs: s.sent.slice(from) }
}

function assertSponsoredPayer(s: Smoke, txs: SentTx[], what: string): void {
	if (txs.length !== 1 || txs[0]?.feePayer !== s.m.l2.sponsoredFpc) {
		throw new Error(`${what}: expected one tx paid by the sponsor, got ${JSON.stringify(txs)}`)
	}
}

async function l2Balance(s: Smoke, kind: DepositKind): Promise<bigint> {
	const token = Contract.at(AztecAddress.fromStringUnsafe(s.m.l2.token.address), tokenArtifact, s.wallet)
	const read = kind === "private" ? token.methods.balance_of_private! : token.methods.balance_of_public!
	return BigInt((await read(s.owner).simulate({ from: s.owner })).result)
}

const usdcOf = (s: Smoke, who: Address) =>
	s.l1.publicClient.readContract({ address: s.m.l1.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })

async function ensureUsdc(s: Smoke, needed: bigint): Promise<void> {
	const held = await usdcOf(s, s.l1.account)
	if (held < needed) throw new Error(`${s.l1.account} holds ${held} USDC units; the smoke needs ${needed}. Fund it first.`)
	const allowance = () =>
		s.l1.publicClient.readContract({
			address: s.m.l1.usdc,
			abi: erc20Abi,
			functionName: "allowance",
			args: [s.l1.account, s.m.l1.permit2],
		})
	await ensurePermit2Allowance({
		allowance,
		approveMax: () =>
			s.c.l1.walletClient.writeContract({
				address: s.m.l1.usdc,
				abi: erc20Abi,
				functionName: "approve",
				args: [s.m.l1.permit2, maxUint256],
				account: s.c.l1.account,
				chain: s.c.l1.chain,
			}),
		waitReceipt: (hash) => s.l1.publicClient.waitForTransactionReceipt({ hash }),
		needed,
	})
}

export interface SponsorTopUp {
	node: AztecNode
	wallet: EmbeddedWallet
	/** Sends the public claim; any account may. */
	from: AztecAddress
	sponsor: AztecAddress
	fee?: { paymentMethod: FeePaymentMethod }
	bridge: Omit<Parameters<typeof bridgeFeeJuice>[0], "node" | "to" | "log">
	log: (m: string) => void
}

/** Bridges a faucet mint to the sponsor and claims it publicly: the private legs must not find it drained. */
export async function topUpSponsor(p: SponsorTopUp): Promise<bigint> {
	const minted = await bridgeFeeJuice({ ...p.bridge, node: p.node, to: p.sponsor, log: p.log })
	const claimCall = FeeJuiceContract.at(p.wallet).methods.claim(
		p.sponsor,
		minted.claimAmount,
		minted.claimSecret,
		new Fr(minted.messageLeafIndex),
	)
	await claimCall.send({ from: p.from, fee: p.fee })
	const balance = await getFeeJuiceBalance(p.sponsor, p.node)
	if (balance < SPONSOR_TOP_UP_FLOOR) throw new Error(`the sponsor holds ${balance} FJ after the top-up`)
	p.log(`sponsor ${p.sponsor} topped up to ${balance}`)
	return balance
}

async function depositAndClaim(s: Smoke, kind: DepositKind): Promise<void> {
	const tip = (await s.l1.publicClient.getBlock()).timestamp
	const d = await prepareDeposit({ amount: LEG_AMOUNT, recipient: s.owner, kind }, s.m, () => tip)
	await submitDeposit(d, s.l1, s.m, s.node)
	const t = await confirmDeposit(d, s.l1, s.m)
	s.log(`${kind} deposit mined (${d.l1TxHash}); waiting until claimable`)
	await waitClaimable(t, s.node, s.wallet, s.m, s.owner, (w) => s.log(`  ${w}`), CLAIMABLE)
	const before = await l2Balance(s, kind)
	const { result, txs } = await sentDuring(s, () => claim(t, s.wallet, s.m, { from: s.owner }))
	if (result !== "claimed") throw new Error(`${kind} claim returned ${result}`)
	if (kind === "private") assertSponsoredPayer(s, txs, "private claim")
	const delta = (await l2Balance(s, kind)) - before
	if (delta !== LEG_AMOUNT) throw new Error(`${kind} claim moved ${delta}, expected ${LEG_AMOUNT}`)
	s.log(`leg ${kind} deposit → claim: +${delta} on L2 (${txs[0]?.hash}, payer ${txs[0]?.feePayer})`)
}

async function exitLeg(s: Smoke, kind: DepositKind, state: SmokeState): Promise<void> {
	const e = { kind, from: s.owner, recipientL1: s.l1.account, amount: LEG_AMOUNT }
	const { result: t, txs } = await sentDuring(s, () => exitToL1(e, s.wallet, s.node, s.m))
	if (kind === "private") assertSponsoredPayer(s, txs, "private exit")
	state[kind] = { tx: t.l2TxHash.toString(), recipient: t.recipient, amount: t.amount.toString(), withdrawn: false }
	writeState(state)
	s.log(`${kind} exit sent (${t.l2TxHash}); ticket stored`)
}

async function withdrawLeg(s: Smoke, kind: DepositKind, state: SmokeState): Promise<void> {
	const stored = state[kind]
	if (!stored || stored.withdrawn) return
	const t = await exitTicketFromTx(TxHash.fromString(stored.tx), stored.recipient, BigInt(stored.amount), s.node, s.outbox, s.m)
	if (t === "not-found") throw new Error(`${kind} exit ${stored.tx} holds no matching message`)
	if (t !== "all-consumed") {
		const before = await usdcOf(s, stored.recipient)
		await finishWithdrawal(t as ExitTicket, s.node, s.outbox, s.l1, s.m, (st) => s.log(`  ${kind} withdraw: ${st}`), {
			timeoutMs: PROVEN_TIMEOUT_MS,
		})
		const delta = (await usdcOf(s, stored.recipient)) - before
		if (delta !== BigInt(stored.amount)) throw new Error(`${kind} withdraw paid ${delta}, expected ${stored.amount}`)
		s.log(`leg ${kind} exit → withdraw: +${delta} on L1`)
	}
	state[kind] = { ...stored, withdrawn: true }
	writeState(state)
}

async function runLegs(s: Smoke): Promise<void> {
	await assertNetworkIdentity(s.node, s.l1.publicClient, s.m)
	const state = readState()
	const pending = (Object.keys(state) as DepositKind[]).filter((k) => !state[k]?.withdrawn)
	if (pending.length === 0) {
		await ensureUsdc(s, 2n * LEG_AMOUNT)
		await depositAndClaim(s, "public")
		await topUpSponsor({
			node: s.node,
			wallet: s.wallet,
			from: s.owner,
			sponsor: AztecAddress.fromStringUnsafe(s.m.l2.sponsoredFpc as string),
			bridge: { l1RpcUrl: s.c.l1RpcUrl, l1PrivateKey: s.c.secrets.l1PrivateKey, l1ChainId: s.c.pins.l1ChainId },
			log: s.log,
		})
		await depositAndClaim(s, "private")
		for (const kind of ["public", "private"] as const) await exitLeg(s, kind, state)
	} else {
		s.log(`resuming stored exits: ${pending.join(", ")}`)
	}
	for (const kind of ["public", "private"] as const) await withdrawLeg(s, kind, state)
}

/**
 * Four legs against the live testnet with real proofs: public and private deposit → claim, then public and private
 * exit → L1 withdraw, each with its exact delta asserted and each private tx's committed payer checked against the
 * sponsor. Exit tickets are stored as they are sent, so a rerun finishes pending withdrawals instead of repeating legs.
 */
export async function smokeTestnet(log: (m: string) => void): Promise<void> {
	const c = testnetContext()
	const m = readManifest(TESTNET_MANIFEST)
	const node = createAztecNodeClient(m.l2.nodeUrl)
	const sent: SentTx[] = []
	await withOwnedTmpDir(async () => {
		const wallet = await openBridgeWallet(recordingNode(node, sent), { prove: true })
		try {
			await registerSponsor(wallet, m)
			await registerBridgeContracts(wallet, m)
			const secret = Fr.fromHexString(c.secrets.aztecSecretKey)
			const owner = (await wallet.createSchnorrAccount(secret, Fr.ZERO, signingKeyFor(secret))).address
			const l1: L1Ctx = { publicClient: c.l1.publicClient, walletClient: c.l1.walletClient, account: c.l1.account.address }
			await runLegs({ c, m, node, wallet, sent, owner, l1, outbox: outboxReader(c.l1.publicClient, m.l1.outbox), log })
		} finally {
			await wallet.stop()
		}
	})
}
