import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import { Verdict, type VerdictState } from "./Verdict"

const chips = () => screen.getAllByRole("listitem").map((li) => `${li.dataset.stage}:${li.dataset.state}`)
const proveChip = () => screen.getAllByRole("listitem").find((li) => li.dataset.stage === "prove")

describe("Verdict", () => {
	it.each<[VerdictState, string[]]>([
		[{ kind: "idle", detail: "" }, ["simulate:todo", "prove:todo", "send:todo", "settle:todo"]],
		[{ kind: "working", stage: "prove", detail: "" }, ["simulate:done", "prove:active", "send:todo", "settle:todo"]],
		[{ kind: "settled", detail: "" }, ["simulate:done", "prove:done", "send:done", "settle:done"]],
		[{ kind: "refused", rule: "r", detail: "" }, ["simulate:failed", "prove:todo", "send:todo", "settle:todo"]],
		[{ kind: "failed", stage: "send", detail: "" }, ["simulate:done", "prove:done", "send:failed", "settle:todo"]],
	])("marks each stage of a %o", (state, expected) => {
		render(<Verdict state={state} />)
		expect(chips()).toEqual(expected)
	})

	it("quotes a refusal's rule verbatim, and leaves out the stages an action skips", () => {
		render(
			<Verdict
				state={{ kind: "refused", rule: "Bridge is paused", detail: "Nothing was sent." }}
				stages={["simulate", "send", "settle"]}
			/>,
		)
		expect(screen.getByTestId(TESTIDS.verdictRule)).toHaveTextContent(/^Bridge is paused$/)
		expect(chips()).toEqual(["simulate:failed", "send:todo", "settle:todo"])
	})

	it("names Presto while a proof is on its way there, and on the Prove chip only once one finished there", () => {
		const { rerender } = render(<Verdict state={{ kind: "working", stage: "prove", detail: "" }} proof={{ attempt: "presto" }} />)
		expect(screen.getByText("Proving with Presto")).toBeInTheDocument()
		expect(proveChip()).toHaveTextContent(/^Prove$/)
		rerender(<Verdict state={{ kind: "settled", detail: "" }} proof={{ ran: "presto" }} />)
		expect(proveChip()).toHaveTextContent(/^Prove · Presto$/)
		rerender(<Verdict state={{ kind: "settled", detail: "" }} proof={{ ran: "browser" }} />)
		expect(proveChip()).toHaveTextContent(/^Prove$/)
	})
})
