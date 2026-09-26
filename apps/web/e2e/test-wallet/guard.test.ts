// @vitest-environment node
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { grantFrom, violation } from "./guard"

const address = (n: number) => AztecAddress.fromStringUnsafe(`0x${n.toString(16).padStart(64, "0")}`)
const bridge = address(0xb1)
const token = address(0x70)
const stranger = address(0x5e)
const grant = grantFrom([
	{ type: "accounts", canGet: true, canCreateAuthWit: true },
	{ type: "contracts", contracts: [bridge, token] },
	{
		type: "simulation",
		utilities: { scope: [{ contract: token, function: "balance_of_private" }] },
		transactions: { scope: [{ contract: bridge, function: "claim_public" }] },
	},
	{
		type: "transaction",
		scope: [
			{ contract: bridge, function: "claim_public" },
			{ contract: token, function: "burn_public" },
		],
	},
])
const exec = (...calls: [AztecAddress, string][]) => ({ calls: calls.map(([to, name]) => ({ to, name })) })

describe("capability enforcement", () => {
	it("refuses every gated call before a grant and lets ungated reads through", async () => {
		expect(await violation(undefined, "getAccounts", [])).toBe("getAccounts before any grant")
		expect(await violation(undefined, "getChainInfo", [])).toBeUndefined()
	})

	it("checks every call of a send, and keeps simulation and send scopes apart", async () => {
		expect(await violation(grant, "sendTx", [exec([bridge, "claim_public"])])).toBeUndefined()
		expect(await violation(grant, "sendTx", [exec([bridge, "claim_public"], [stranger, "sponsor_unconditionally"])])).toBe(
			`send of ${stranger}.sponsor_unconditionally`,
		)
		expect(await violation(grant, "simulateTx", [exec([token, "burn_public"])])).toBe(`simulation of ${token}.burn_public`)
		expect(await violation(grant, "executeUtility", [{ to: token, name: "balance_of_private" }])).toBeUndefined()
	})

	it("registers only granted contracts and authorizes only granted calls, inside batches too", async () => {
		expect(await violation(grant, "registerContract", [{ address: stranger }])).toBe(`registration of ${stranger}`)
		expect(
			await violation(grant, "createAuthWit", [bridge, { caller: bridge, call: { to: token, name: "burn_public" } }]),
		).toBeUndefined()
		expect(await violation(grant, "createAuthWit", [bridge, { caller: bridge, call: { to: token, name: "transfer" } }])).toBe(
			`authwit for ${token}.transfer`,
		)
		const batch = [
			{ name: "getAccounts", args: [] },
			{ name: "registerContract", args: [{ address: stranger }] },
		]
		expect(await violation(grant, "batch", [batch])).toBe(`registration of ${stranger}`)
	})
})
