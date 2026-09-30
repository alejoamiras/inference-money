import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { SponsorUnavailableError } from "@inference-money/bridge-core"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DepositFlow } from "@/bridge/deposit-flow"
import type { BridgeOps } from "@/bridge/env"
import { useFlow } from "@/bridge/flow-store"
import { deferred, fakeEnv, L1_ACCOUNT, offlineDepositOps } from "@/bridge/test/fake-env"
import type { WithdrawFlow, WithdrawSnapshot } from "@/bridge/withdraw-flow"
import { MANIFEST } from "@/config/network"
import { TESTIDS } from "@/lib/testids"
import { DepositForm, PRIVACY_COPY } from "./DepositForm"
import { DepositProgress } from "./DepositProgress"
import { WithdrawForm } from "./WithdrawForm"
import { WithdrawProgress } from "./WithdrawProgress"

const L2_ACCOUNT = `0x${"0a".repeat(32)}`
const tid = (id: string) => screen.getByTestId(id)

const offlineEnv = (ops: Partial<BridgeOps>) =>
	fakeEnv({ ...offlineDepositOps, ...ops }, { account: AztecAddress.fromStringUnsafe(L2_ACCOUNT) })

function LiveDeposit({ flow }: { flow: DepositFlow }) {
	return <DepositProgress flow={flow} s={useFlow(flow.store)} />
}

describe("DepositForm", () => {
	const setup = (o: { balance?: bigint; paused?: boolean } = {}) => {
		const confirm = vi.fn()
		render(
			<DepositForm
				flow={{ confirm } as unknown as DepositFlow}
				notice={null}
				l1Account={L1_ACCOUNT}
				l1Balance={o.balance ?? 10_000_000n}
				l2Account={L2_ACCOUNT}
				paused={o.paused ?? false}
			/>,
		)
		return { confirm, user: userEvent.setup() }
	}

	it("validates the amount as typed and confirms exactly the reviewed values", async () => {
		const { confirm, user } = setup()
		const amount = tid(TESTIDS.depositAmount)
		await user.type(amount, "1.2345678")
		expect(screen.getByText(/at most 6 decimal places/)).toBeInTheDocument()
		expect(tid(TESTIDS.depositReview)).toBeDisabled()
		await user.clear(amount)
		await user.type(amount, "11")
		expect(screen.getByText(/more than your USDC balance/)).toBeInTheDocument()
		await user.clear(amount)
		await user.type(amount, "1.234567")
		expect(screen.getByText(PRIVACY_COPY.private)).toBeInTheDocument()

		await user.click(tid(TESTIDS.depositReview))
		expect(tid(TESTIDS.depositSummary)).toHaveTextContent("1.234567 USDC")
		expect(tid(TESTIDS.depositSummary)).toHaveTextContent(L2_ACCOUNT)
		expect(screen.getByText(/Permit2/)).toHaveTextContent("no limit")
		await user.click(tid(TESTIDS.depositConfirm))
		expect(confirm).toHaveBeenCalledWith({ amount: 1_234_567n, kind: "private", recipient: L2_ACCOUNT })
	})

	it("offers no review while the bridge is paused", async () => {
		const { user } = setup({ paused: true })
		await user.type(tid(TESTIDS.depositAmount), "1")
		expect(tid(TESTIDS.depositReview)).toBeDisabled()
	})
})

describe("WithdrawForm", () => {
	it("refuses the bridge portal as the Ethereum recipient", async () => {
		const exit = vi.fn()
		render(
			<WithdrawForm
				flow={{ exit } as unknown as WithdrawFlow}
				manifest={MANIFEST}
				notice={null}
				l1Account={L1_ACCOUNT}
				l2Account={L2_ACCOUNT}
				l2Balances={{ public: 0n, private: 10_000_000n }}
				paused={false}
			/>,
		)
		const user = userEvent.setup()
		await user.type(tid(TESTIDS.withdrawAmount), "1")
		expect(tid(TESTIDS.withdrawReview)).toBeEnabled()
		await user.clear(tid(TESTIDS.withdrawRecipient))
		await user.type(tid(TESTIDS.withdrawRecipient), MANIFEST.l1.portal)
		expect(screen.getByText(/could never be paid out/)).toBeInTheDocument()
		expect(tid(TESTIDS.withdrawReview)).toBeDisabled()
		await user.click(tid(TESTIDS.withdrawReview))
		expect(exit).not.toHaveBeenCalled()
	})
})

describe("DepositProgress", () => {
	it("moves the stepper with the flow, from sent to ready to done", async () => {
		const claimable = deferred<void>()
		const f = await offlineEnv({ waitClaimable: () => claimable.promise })
		const flow = new DepositFlow(f.env)
		render(<LiveDeposit flow={flow} />)
		const running = act(() => flow.confirm({ amount: 1_000_000n, kind: "public", recipient: f.account.toString() }))
		await waitFor(() => expect(tid(TESTIDS.stepper)).toHaveAttribute("data-current", "Ready on Aztec"))
		expect(screen.getByText(/Sent on Ethereum/).closest("li")).toHaveAttribute("data-state", "done")

		claimable.resolve()
		await running
		expect(tid(TESTIDS.stepper)).toHaveAttribute("data-current", "done")
		expect(screen.getByText(/Done\. 1 USDC is in your public balance/)).toBeInTheDocument()
	})

	it("pays the fee from the wallet only when the user clicks through the fallback", async () => {
		const claim = vi.fn().mockRejectedValueOnce(new SponsorUnavailableError("The fee sponsor could not pay for this claim."))
		claim.mockResolvedValue("claimed")
		const f = await offlineEnv({ claim })
		const flow = new DepositFlow(f.env)
		render(<LiveDeposit flow={flow} />)
		await act(() => flow.confirm({ amount: 1_000_000n, kind: "private", recipient: f.account.toString() }))

		expect(tid(TESTIDS.feeFallback)).toHaveTextContent("link your account")
		expect(claim).toHaveBeenCalledTimes(1)
		await userEvent.setup().click(tid(TESTIDS.feeFallbackAccept))
		await waitFor(() => expect(tid(TESTIDS.stepper)).toHaveAttribute("data-current", "done"))
		expect(claim.mock.calls.map((c) => c[4].fee)).toEqual([undefined, "wallet-default"])
	})
})

describe("WithdrawProgress", () => {
	it("shows the Aztec tx hash to save while the exit is in flight, and keeps it once done", () => {
		const hash = `0x${"1b".repeat(32)}`
		const s: WithdrawSnapshot = {
			step: "withdrawing",
			kind: "private",
			amount: 4_000_000n,
			recipient: L1_ACCOUNT,
			l2TxHash: hash,
			l1TxHash: null,
			outcome: null,
			notice: null,
			recovery: null,
			proving: null,
		}
		const flow = {} as WithdrawFlow
		const { rerender } = render(<WithdrawProgress flow={flow} s={s} />)
		expect(tid(TESTIDS.withdrawTxHash)).toHaveTextContent(hash)
		expect(screen.getByText(/Save these to finish later/)).toBeInTheDocument()

		rerender(<WithdrawProgress flow={flow} s={{ ...s, step: "done", outcome: "withdrawn" }} />)
		expect(tid(TESTIDS.withdrawTxHash)).toHaveTextContent(hash)
		expect(screen.queryByText(/Save these to finish later/)).toBeNull()
	})
})
