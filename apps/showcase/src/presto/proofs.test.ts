import type { PrestoPhase } from "@alejoamiras/presto"
import { describe, expect, it } from "vitest"
import { type ProofSource, proofTracker } from "./proofs"

/** One proof whose prover reports `phases`, in order, while it runs. */
async function prove(phases: PrestoPhase[]) {
	const t = proofTracker()
	await t.around(async () => {
		for (const phase of phases) t.onPhase(phase)
		return "proof"
	})
	return t.proof.get()
}

describe("proof attribution", () => {
	it.each<[string, PrestoPhase[], ProofSource]>([
		["finished on Presto", ["detect", "serialize", "transmit", "proving", "proved", "receive"], "presto"],
		[
			"sent to Presto, then proved here when the connection failed",
			["detect", "serialize", "transmit", "proving", "secure-connection-unavailable", "fallback", "proving", "proved", "receive"],
			"browser",
		],
		[
			"proved by Presto, then again here when its answer did not decode",
			["transmit", "proving", "proved", "receive", "fallback", "proving", "proved", "receive"],
			"browser",
		],
		["kept in the page", ["proving", "proved"], "browser"],
	])("credits a proof %s to where it finished", async (_, phases, ran) => {
		expect(await prove(phases)).toEqual({ ran })
	})

	it("runs the guard first, says where the proof is going, and credits nothing to a proof that failed", async () => {
		const t = proofTracker()
		const order: string[] = []
		const unguardStale = t.guard(async () => void order.push("stale guard"))
		t.guard(async () => void order.push("guard"))
		unguardStale()
		const failing = t.around(async () => {
			order.push("prove")
			t.onPhase("transmit")
			expect(t.proof.get()).toEqual({ attempt: "presto" })
			throw new Error("the node refused it")
		})
		await expect(failing).rejects.toThrow("the node refused it")
		expect(order).toEqual(["guard", "prove"])
		expect(t.proof.get()).toEqual({})
	})
})
