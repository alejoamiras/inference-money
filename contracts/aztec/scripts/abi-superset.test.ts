import { describe, expect, it } from "bun:test"
import { type ContractArtifact, loadContractArtifact } from "@aztec-labs/stdlib/abi"
import type { NoirCompiledContract } from "@aztec-labs/stdlib/noir"
import { artifactIdentity, normalizedFunctions, storageSlots } from "./artifact-identity"

const UPSTREAM = new URL("../node_modules/@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json", import.meta.url)
	.pathname
const FORK = new URL("../token/target/merchant_token-Token.json", import.meta.url).pathname

// Everything the fork adds to aztec-standards' Token. The rest must be upstream's, unchanged, so integrations written
// against upstream (Galactica's x402 calls among them) keep working.
const ADDED_FUNCTIONS: string[] = []
const ADDED_STORAGE: string[] = []
const ADDED_EVENTS: string[] = []

const load = async (path: string) => (await Bun.file(path).json()) as NoirCompiledContract
const upstreamJson = await load(UPSTREAM)
const forkJson = await load(FORK)
const upstream = loadContractArtifact(upstreamJson)
const fork = loadContractArtifact(forkJson)

const events = (a: ContractArtifact) => a.outputs.structs.events as { path: string }[]
const added = (all: string[], base: string[]) => all.filter((n) => !base.includes(n)).sort()

describe("the merchant token is an ABI superset of aztec-standards' Token", () => {
	it("keeps every upstream function's selector, type, attributes, parameters and returns", async () => {
		const forkFns = await normalizedFunctions(fork)
		for (const fn of await normalizedFunctions(upstream)) {
			expect(forkFns.find((f) => f.name === fn.name && f.functionType === fn.functionType)).toEqual(fn)
		}
	})

	it("adds exactly the listed functions", async () => {
		const names = async (a: ContractArtifact) => (await normalizedFunctions(a)).map((f) => f.name)
		expect(added(await names(fork), await names(upstream))).toEqual([...ADDED_FUNCTIONS].sort())
	})

	it("keeps upstream's storage slots and adds exactly the listed fields", () => {
		const forkSlots = storageSlots(fork)
		for (const field of storageSlots(upstream)) expect(forkSlots).toContainEqual(field)
		const names = (a: ContractArtifact) => storageSlots(a).map((s) => s.name)
		expect(added(names(fork), names(upstream))).toEqual([...ADDED_STORAGE].sort())
	})

	it("keeps upstream's events and adds exactly the listed ones", () => {
		for (const event of events(upstream)) expect(events(fork)).toContainEqual(event)
		const paths = (a: ContractArtifact) => events(a).map((e) => e.path)
		expect(added(paths(fork), paths(upstream))).toEqual([...ADDED_EVENTS].sort())
	})

	it("is still upstream's contract class", async () => {
		expect((await artifactIdentity(forkJson)).classId).toBe((await artifactIdentity(upstreamJson)).classId)
	}, 30_000)
})
