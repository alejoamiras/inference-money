import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { erc20Abi } from "viem"
import { useReadContract } from "wagmi"
import { formatUsdc } from "@/bridge/amount"
import { useBridge } from "@/bridge/context"
import { useFlow } from "@/bridge/flow-store"
import { Button } from "@/components/ui/button"
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

/** Each side's account once it is usable: the Ethereum one on the bridge's chain, the Aztec one with contracts registered. */
interface Accounts {
	readonly l1: `0x${string}` | null
	readonly l2: string | null
}

function useAccounts(): Accounts {
	const l1 = useL1()
	const snap = useAztecSession(aztecSession)
	return {
		l1: l1.status === "connected" && !l1.wrongChain && l1.address ? l1.address : null,
		l2: snap.status === "connected" && snap.contractsReady && snap.selectedAccount ? snap.selectedAccount : null,
	}
}

function useBalances(accounts: Accounts) {
	const { env } = useBridge()
	const m = env.manifest
	const l1 = useReadContract({
		address: m.l1.usdc,
		abi: erc20Abi,
		functionName: "balanceOf",
		args: accounts.l1 ? [accounts.l1] : undefined,
		chainId: L1_CHAIN.id,
		query: { enabled: accounts.l1 !== null, refetchInterval: 30_000 },
	})
	const l2 = useQuery({
		queryKey: ["l2-balances", accounts.l2],
		queryFn: async () => {
			const ctx = env.l2()
			const [pub, priv] = await Promise.all([env.ops.l2Balance(ctx, m, "public"), env.ops.l2Balance(ctx, m, "private")])
			return { public: pub, private: priv }
		},
		enabled: accounts.l2 !== null,
		refetchInterval: 60_000,
	})
	const paused = useQuery({
		queryKey: ["bridge-paused"],
		queryFn: () => env.ops.isBridgePaused(env.node, m),
		refetchInterval: 30_000,
	})
	return { l1: l1.data, l2: l2.data, paused: paused.data === true }
}

type Balances = ReturnType<typeof useBalances>

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

const BOTH = "Connect your Ethereum wallet and your Aztec wallet to move USDC between them."

function DepositPanel({ accounts, balances }: { accounts: Accounts; balances: Balances }) {
	const { deposit } = useBridge()
	const s = useFlow(deposit.store)
	// A checkpointed claim is already in the balance; finalizing it changes nothing on screen.
	useRefreshOnDone(s.step === "finalizing" || s.step === "done")
	if (s.step !== "idle") return <DepositProgress flow={deposit} s={s} />
	if (!accounts.l1 || !accounts.l2) return <Gate>{BOTH}</Gate>
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

function NewWithdrawal({ accounts, balances }: { accounts: Accounts; balances: Balances }) {
	const { withdraw, env } = useBridge()
	const s = useFlow(withdraw.store)
	if (!accounts.l1 || !accounts.l2) return <Gate>{BOTH}</Gate>
	return (
		<WithdrawForm
			flow={withdraw}
			manifest={env.manifest}
			notice={s.notice}
			l1Account={accounts.l1}
			l2Account={accounts.l2}
			l2Balances={balances.l2}
			paused={balances.paused}
		/>
	)
}

function WithdrawPanel({ accounts, balances }: { accounts: Accounts; balances: Balances }) {
	const { withdraw } = useBridge()
	const s = useFlow(withdraw.store)
	const [mode, setMode] = useState<WithdrawMode>("new")
	useRefreshOnDone(s.step === "done")
	if (s.step === "unconfirmed") {
		return (
			<div className="grid gap-4">
				<Notice tone="warning">{s.notice}</Notice>
				<FinishForm flow={withdraw} notice={null} l1Account={accounts.l1 ?? ""} prefill={s.recovery} />
				{/* A known hash is a burned exit: only finishing it leaves. Without one, the wallet's activity decides. */}
				{s.recovery?.l2TxHash ? null : (
					<Button variant="ghost" onClick={withdraw.reset} data-testid={TESTIDS.withdrawReset}>
						Close
					</Button>
				)}
			</div>
		)
	}
	if (s.step !== "idle") return <WithdrawProgress flow={withdraw} s={s} />
	return (
		<div className="grid gap-4">
			<Choices name="withdraw-mode" value={mode} choices={MODES} onChange={setMode} testId={TESTIDS.withdrawMode} />
			{mode === "new" ? <NewWithdrawal accounts={accounts} balances={balances} /> : null}
			{mode === "finish" && accounts.l1 ? (
				<FinishForm flow={withdraw} notice={s.notice} l1Account={accounts.l1} prefill={null} />
			) : null}
			{/* Finishing only submits on Ethereum, so it needs no Aztec wallet. */}
			{mode === "finish" && !accounts.l1 ? <Gate>Connect your Ethereum wallet to finish a withdrawal.</Gate> : null}
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
			<div className="flex flex-wrap gap-6">
				{accounts.l1 ? <Balance label="Ethereum" value={balances.l1} testId={TESTIDS.balanceL1} /> : null}
				{accounts.l2 ? <Balance label="Aztec, private" value={balances.l2?.private} testId={TESTIDS.balanceL2Private} /> : null}
				{accounts.l2 ? <Balance label="Aztec, public" value={balances.l2?.public} testId={TESTIDS.balanceL2Public} /> : null}
			</div>
			{direction === "deposit" ? (
				<DepositPanel accounts={accounts} balances={balances} />
			) : (
				<WithdrawPanel accounts={accounts} balances={balances} />
			)}
		</section>
	)
}
