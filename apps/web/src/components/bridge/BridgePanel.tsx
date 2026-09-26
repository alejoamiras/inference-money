import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { erc20Abi } from "viem"
import { useReadContract } from "wagmi"
import { formatUsdc } from "@/bridge/amount"
import { useBridge } from "@/bridge/context"
import { useFlow } from "@/bridge/flow-store"
import { L1_CHAIN } from "@/config/network"
import { TESTIDS } from "@/lib/testids"
import { useL1 } from "@/wallet/l1"
import { aztecSession } from "@/wallet/session"
import { useAztecSession } from "@/wallet/useAztecSession"
import { DepositForm } from "./DepositForm"
import { DepositProgress } from "./DepositProgress"
import { FinishForm } from "./FinishForm"
import { Choices, Notice } from "./parts"
import { WithdrawForm } from "./WithdrawForm"
import { WithdrawProgress } from "./WithdrawProgress"

type Direction = "deposit" | "withdraw"
type WithdrawMode = "new" | "finish"

interface Accounts {
	readonly l1: `0x${string}`
	readonly l2: string
}

/** Both wallets connected, on the bridge's networks, with the bridge's contracts registered; else null. */
function useAccounts(): Accounts | null {
	const l1 = useL1()
	const snap = useAztecSession(aztecSession)
	const l1Ready = l1.status === "connected" && !l1.wrongChain && l1.address
	const l2Ready = snap.status === "connected" && snap.contractsReady && snap.selectedAccount
	return l1Ready && l2Ready && l1.address && snap.selectedAccount ? { l1: l1.address, l2: snap.selectedAccount } : null
}

function useBalances(accounts: Accounts | null) {
	const { env } = useBridge()
	const m = env.manifest
	const l1 = useReadContract({
		address: m.l1.usdc,
		abi: erc20Abi,
		functionName: "balanceOf",
		args: accounts ? [accounts.l1] : undefined,
		chainId: L1_CHAIN.id,
		query: { enabled: accounts !== null, refetchInterval: 30_000 },
	})
	const l2 = useQuery({
		queryKey: ["l2-balances", accounts?.l2],
		queryFn: async () => {
			const ctx = env.l2()
			const [pub, priv] = await Promise.all([env.ops.l2Balance(ctx, m, "public"), env.ops.l2Balance(ctx, m, "private")])
			return { public: pub, private: priv }
		},
		enabled: accounts !== null,
		refetchInterval: 60_000,
	})
	const paused = useQuery({
		queryKey: ["bridge-paused"],
		queryFn: () => env.ops.isBridgePaused(env.node, m),
		refetchInterval: 30_000,
	})
	return { l1: l1.data, l2: l2.data, paused: paused.data === true }
}

function Balance({ label, value, testId }: { label: string; value: bigint | undefined; testId: string }) {
	return (
		<div className="grid">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="font-mono text-sm" data-testid={testId} data-value={value?.toString()}>
				{value === undefined ? "…" : `${formatUsdc(value)} USDC`}
			</span>
		</div>
	)
}

/** Refetches every balance once a flow finishes, so the numbers on screen include it. */
function useRefreshOnDone(done: boolean) {
	const client = useQueryClient()
	useEffect(() => {
		if (done) void client.invalidateQueries()
	}, [done, client])
}

function Gate({ children }: { children: ReactNode }) {
	return (
		<p className="text-sm text-muted-foreground" data-testid={TESTIDS.bridgeGate}>
			{children}
		</p>
	)
}

const GATE_COPY = "Connect your Ethereum wallet and your Aztec wallet to move USDC between them."

function DepositPanel({ accounts, balances }: { accounts: Accounts | null; balances: ReturnType<typeof useBalances> }) {
	const { deposit } = useBridge()
	const s = useFlow(deposit.store)
	useRefreshOnDone(s.step === "done")
	if (s.step !== "idle") return <DepositProgress flow={deposit} s={s} />
	if (!accounts) return <Gate>{GATE_COPY}</Gate>
	return (
		<DepositForm
			flow={deposit}
			notice={s.notice}
			l1Account={accounts.l1}
			l1Balance={balances.l1}
			l2Account={accounts.l2}
			paused={balances.paused}
		/>
	)
}

const MODES = [
	{ value: "new", label: "New withdrawal" },
	{ value: "finish", label: "Finish a withdrawal" },
] as const

function WithdrawPanel({ accounts, balances }: { accounts: Accounts | null; balances: ReturnType<typeof useBalances> }) {
	const { withdraw, env } = useBridge()
	const s = useFlow(withdraw.store)
	const [mode, setMode] = useState<WithdrawMode>("new")
	useRefreshOnDone(s.step === "done")
	if (s.step === "unconfirmed" && accounts) {
		return (
			<div className="grid gap-4">
				<Notice tone="warning">{s.notice}</Notice>
				<FinishForm flow={withdraw} notice={null} l1Account={accounts.l1} prefill={s.recovery} />
			</div>
		)
	}
	if (s.step !== "idle") return <WithdrawProgress flow={withdraw} s={s} />
	if (!accounts) return <Gate>{GATE_COPY}</Gate>
	return (
		<div className="grid gap-4">
			<Choices name="withdraw-mode" value={mode} choices={MODES} onChange={setMode} testId={TESTIDS.withdrawMode} />
			{mode === "new" ? (
				<WithdrawForm
					flow={withdraw}
					manifest={env.manifest}
					notice={s.notice}
					l1Account={accounts.l1}
					l2Account={accounts.l2}
					l2Balances={balances.l2}
					paused={balances.paused}
				/>
			) : (
				<FinishForm flow={withdraw} notice={s.notice} l1Account={accounts.l1} prefill={null} />
			)}
		</div>
	)
}

const DIRECTIONS = [
	{ value: "deposit", label: "Ethereum → Aztec" },
	{ value: "withdraw", label: "Aztec → Ethereum" },
] as const

export function BridgePanel() {
	const accounts = useAccounts()
	const balances = useBalances(accounts)
	const [direction, setDirection] = useState<Direction>("deposit")
	return (
		<section className="grid gap-6">
			<Choices name="direction" value={direction} choices={DIRECTIONS} onChange={setDirection} testId={TESTIDS.direction} />
			{balances.paused ? (
				<p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive" data-testid={TESTIDS.bridgePaused}>
					The bridge is paused. New deposits and withdrawals are refused until it resumes; nothing you already sent is lost.
				</p>
			) : null}
			{accounts ? (
				<div className="flex flex-wrap gap-6">
					<Balance label="Ethereum" value={balances.l1} testId={TESTIDS.balanceL1} />
					<Balance label="Aztec, private" value={balances.l2?.private} testId={TESTIDS.balanceL2Private} />
					<Balance label="Aztec, public" value={balances.l2?.public} testId={TESTIDS.balanceL2Public} />
				</div>
			) : null}
			{direction === "deposit" ? (
				<DepositPanel accounts={accounts} balances={balances} />
			) : (
				<WithdrawPanel accounts={accounts} balances={balances} />
			)}
		</section>
	)
}
