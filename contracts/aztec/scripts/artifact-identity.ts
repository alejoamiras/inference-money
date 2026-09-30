// The on-chain + SDK identity of a compiled Noir contract artifact. `compile.sh --check` requires a fresh build to
// match the committed artifact on both halves:
//   - classId: what a deploy binds (bytecode, private functions, artifact hash).
//   - abi: what aztec.js encodes calls against. The class id alone misses it: the artifact hash excludes public ABI
//     entries, so renaming a public function in the JSON leaves the class id unchanged.
// Debug metadata (file maps, source paths) is deliberately outside both.
//
//   bun scripts/artifact-identity.ts <artifact.json>            print the identity as JSON
//   bun scripts/artifact-identity.ts compare <want.json> <got.json>   exit 1 on any difference
import { type ContractArtifact, FunctionSelector, loadContractArtifact } from "@aztec-labs/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec-labs/stdlib/contract"
import type { NoirCompiledContract } from "@aztec-labs/stdlib/noir"

export type ArtifactIdentity = { classId: string; abi: string }

type Fn = ContractArtifact["nonDispatchPublicFunctions"][number]

async function normalizeFunction(f: Fn & { functionType?: string }) {
	return {
		name: f.name,
		selector: (await FunctionSelector.fromNameAndParameters(f.name, f.parameters)).toString(),
		functionType: f.functionType,
		isOnlySelf: f.isOnlySelf,
		isStatic: f.isStatic,
		isInitializer: f.isInitializer,
		parameters: f.parameters.map((p) => ({ name: p.name, type: p.type, visibility: p.visibility })),
		returnTypes: f.returnTypes,
	}
}

/** Canonical JSON of the SDK-facing ABI: every function with its selector, the storage layout and the outputs. */
export async function normalizedAbi(artifact: ContractArtifact): Promise<string> {
	const fns = await Promise.all([...artifact.functions, ...artifact.nonDispatchPublicFunctions].map(normalizeFunction))
	fns.sort((a, b) => `${a.name}/${a.functionType}`.localeCompare(`${b.name}/${b.functionType}`))
	const storage = Object.entries(artifact.storageLayout)
		.map(([name, layout]) => ({ name, slot: layout.slot.toString() }))
		.sort((a, b) => a.name.localeCompare(b.name))
	return JSON.stringify({ name: artifact.name, functions: fns, storage, outputs: artifact.outputs })
}

export async function artifactIdentity(json: NoirCompiledContract): Promise<ArtifactIdentity> {
	const artifact = loadContractArtifact(json)
	const cls = await getContractClassFromArtifact(artifact)
	return { classId: cls.id.toString(), abi: await normalizedAbi(artifact) }
}

/** Human-readable differences between two identities; empty when they match. */
export function identityDiff(want: ArtifactIdentity, got: ArtifactIdentity): string[] {
	const diffs: string[] = []
	if (want.classId !== got.classId) diffs.push(`class id: committed ${want.classId}, source builds ${got.classId}`)
	if (want.abi !== got.abi) diffs.push("SDK-facing ABI differs (function names, selectors, types, storage or outputs)")
	return diffs
}

async function load(path: string): Promise<ArtifactIdentity> {
	return artifactIdentity((await Bun.file(path).json()) as NoirCompiledContract)
}

if (import.meta.main) {
	const [cmd, a, b] = process.argv.slice(2)
	if (cmd === "compare" && a && b) {
		const diffs = identityDiff(await load(a), await load(b))
		for (const d of diffs) console.error(d)
		process.exit(diffs.length === 0 ? 0 : 1)
	} else if (cmd && !a) {
		console.log(JSON.stringify(await load(cmd)))
	} else {
		console.error("usage: bun scripts/artifact-identity.ts <artifact.json> | compare <want.json> <got.json>")
		process.exit(2)
	}
}
