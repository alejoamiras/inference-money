import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils"
import type { ContractArtifact } from "@aztec-labs/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec-labs/stdlib/contract"
import { DelayedPublicMutableValues } from "@aztec-labs/stdlib/delayed-public-mutable"
import {
	assertNetworkIdentity,
	BRIDGE_CONTRACTS,
	type BridgeManifest,
	delayAt,
	instanceFromRecord,
	isBridgePaused,
	sponsorInstance,
	tokenArtifact,
	tokenBridgeArtifact,
	tokenMinterProxyArtifact,
} from "@inference-money/bridge-core"
import type { Abi, Address, Hex, PublicClient } from "viem"

import { type BridgeEvmArtifacts, maskImmutables } from "./evm"
import type { Check } from "./preflight"
import { standardContractAddresses } from "./standard"

const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail })
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
const pin = (name: string, actual: unknown, want: unknown) =>
	check(name, same(actual, want), `${actual}${same(actual, want) ? "" : ` (want ${want})`}`)

async function attempt(name: string, fn: () => Promise<Check[]>): Promise<Check[]> {
	try {
		return await fn()
	} catch (e) {
		return [check(name, false, e instanceof Error ? e.message : String(e))]
	}
}

async function codeMatches(
	l1: PublicClient,
	name: string,
	address: Address,
	a: { deployedBytecode: Hex; immutableRanges: { start: number; length: number }[] },
) {
	const code = (await l1.getCode({ address })) ?? "0x"
	const ok = maskImmutables(code, a.immutableRanges) === maskImmutables(a.deployedBytecode, a.immutableRanges)
	return check(`${name} runtime bytecode == fresh forge build (immutables masked)`, ok, `${(code.length - 2) / 2} bytes`)
}

async function verifyL1(l1: PublicClient, evm: BridgeEvmArtifacts, m: BridgeManifest, l1Deployer: Address): Promise<Check[]> {
	const { portal, router } = evm
	const read = (address: Address, abi: Abi, functionName: string) => l1.readContract({ address, abi, functionName }) as Promise<unknown>
	const p = (fn: string) => read(m.l1.portal, portal.abi, fn)
	const r = (fn: string) => read(m.l1.router, router.abi, fn)
	const [registry, underlying, l2Bridge, rollupVersion, initializer, outbox, inbox, routerOfPortal] = await Promise.all(
		["registry", "underlying", "l2Bridge", "rollupVersion", "initializer", "outbox", "inbox", "router"].map(p),
	)
	const [permit2, portalOfRouter, token] = await Promise.all(["PERMIT2", "PORTAL", "TOKEN"].map(r))
	const permit2Code = await l1.getCode({ address: m.l1.permit2 })
	return [
		await codeMatches(l1, "portal", m.l1.portal, portal),
		await codeMatches(l1, "router", m.l1.router, router),
		pin("portal.registry", registry, m.l1.registry),
		pin("portal.underlying", underlying, m.l1.usdc),
		pin("portal.l2Bridge", l2Bridge, m.l2.bridge.address),
		pin("portal.rollupVersion", rollupVersion, m.l2.rollupVersion),
		pin("portal.initializer (L1 deployer)", initializer, l1Deployer),
		pin("portal.outbox", outbox, m.l1.outbox),
		pin("portal.inbox", inbox, m.l1.inbox),
		pin("portal.router", routerOfPortal, m.l1.router),
		pin("router.PERMIT2", permit2, m.l1.permit2),
		pin("router.PORTAL", portalOfRouter, m.l1.portal),
		pin("router.TOKEN", token, m.l1.usdc),
		check("Permit2 has code", !!permit2Code && permit2Code.length > 2, `${((permit2Code?.length ?? 2) - 2) / 2} bytes`),
	]
}

async function verifyInstances(node: AztecNode, m: BridgeManifest): Promise<Check[]> {
	const out: Check[] = []
	for (const [key, artifact] of BRIDGE_CONTRACTS) {
		const rec = m.l2[key]
		const derived = await instanceFromRecord(artifact, rec)
		const classId = (await getContractClassFromArtifact(artifact)).id.toString()
		const onChain = await node.getContract(derived.address)
		const published = await node.getContractClass(Fr.fromHexString(classId))
		out.push(pin(`${key} class id == artifact`, rec.classId, classId))
		out.push(check(`${key} instance published`, onChain !== undefined, rec.address))
		out.push(pin(`${key} on-chain class`, onChain?.currentContractClassId.toString(), classId))
		out.push(check(`${key} class published`, published !== undefined, classId))
	}
	return out
}

/** A storage field's slot in `artifact`'s layout, `offset` fields into its packed value. */
function layoutSlot(artifact: ContractArtifact, field: string, offset = 0): Fr {
	const layout = artifact.storageLayout[field]
	if (!layout) throw new Error(`${artifact.name} has no ${field} storage`)
	return layout.slot.add(new Fr(offset))
}

const reader = (node: AztecNode, contract: string) => (slot: Fr) =>
	node.getPublicStorageAt("latest", AztecAddress.fromStringUnsafe(contract), slot)

async function verifyL2Wiring(node: AztecNode, m: BridgeManifest): Promise<Check[]> {
	const { proxy, token, bridge } = m.l2
	const deployer = bridge.deployer
	const [b, p, t] = [reader(node, bridge.address), reader(node, proxy.address), reader(node, token.address)]
	// A PublicImmutable's packed value starts at its slot: the bridge config is (token_minter_proxy, token, portal).
	const [bOwner, bProxy, bToken, bPortal, bPaused, pOwner, pToken, pBridge, tDecimals, tMinter, tAuth] = await Promise.all([
		b(layoutSlot(tokenBridgeArtifact, "owner")),
		b(layoutSlot(tokenBridgeArtifact, "config")),
		b(layoutSlot(tokenBridgeArtifact, "config", 1)),
		b(layoutSlot(tokenBridgeArtifact, "config", 2)),
		isBridgePaused(node, m),
		p(layoutSlot(tokenMinterProxyArtifact, "owner")),
		p(layoutSlot(tokenMinterProxyArtifact, "token")),
		p(layoutSlot(tokenMinterProxyArtifact, "bridge")),
		t(layoutSlot(tokenArtifact, "decimals")),
		t(layoutSlot(tokenArtifact, "minter")),
		t(layoutSlot(tokenArtifact, "auth_contract")),
	])
	return [
		pin("bridge owner == deployer", bOwner, deployer),
		pin("bridge config.token_minter_proxy", bProxy, proxy.address),
		pin("bridge config.token", bToken, token.address),
		check("bridge config.portal", bPortal.toBigInt() === BigInt(m.l1.portal), bPortal.toString()),
		check("bridge not paused", !bPaused, String(bPaused)),
		pin("proxy owner == deployer", pOwner, deployer),
		pin("proxy token", pToken, token.address),
		pin("proxy bridge", pBridge, bridge.address),
		check("token decimals == 6", tDecimals.toBigInt() === 6n, tDecimals.toString()),
		pin("token minter == proxy", tMinter, proxy.address),
		check("token auth_contract == 0", tAuth.isZero(), tAuth.toString()),
	]
}

/** The merchant roles: the admin, no handover pending, and the guardian slot's delay settled at the setting. */
async function verifyMerchantRoles(node: AztecNode, m: BridgeManifest): Promise<Check[]> {
	const t = reader(node, m.l2.token.address)
	const [admin, pending, setting, guardian, latest] = await Promise.all([
		t(layoutSlot(tokenArtifact, "merchant_admin")),
		t(layoutSlot(tokenArtifact, "pending_merchant_admin")),
		t(layoutSlot(tokenArtifact, "merchant_delay")),
		DelayedPublicMutableValues.readFromTree(layoutSlot(tokenArtifact, "merchant_guardian"), t),
		node.getBlockData("latest"),
	])
	if (!latest) throw new Error("the node returned no latest block")
	const now = latest.header.globalVariables.timestamp
	const delay = delayAt(guardian.sdc, now)
	return [
		pin("token merchant admin == deployer", admin, m.l2.token.deployer),
		check("token merchant admin: no handover pending", pending.isZero(), pending.toString()),
		pin("token guardian slot delay == merchant delay", delay, setting.toBigInt()),
		check("token guardian slot delay: no change pending", guardian.sdc.timestampOfChange <= now, `${delay}s`),
	]
}

async function verifyEnvironment(node: AztecNode, m: BridgeManifest): Promise<Check[]> {
	const standard = await Promise.all(
		(await standardContractAddresses()).map(async (s) =>
			check(`standard ${s.name} published`, (await node.getContract(s.address)) !== undefined, s.address.toString()),
		),
	)
	if (!m.l2.sponsoredFpc) return [...standard, check("SponsoredFPC", true, "none on this network")]
	const pinned = (await sponsorInstance()).address
	const fpc = AztecAddress.fromStringUnsafe(m.l2.sponsoredFpc)
	const [balance, published] = await Promise.all([getFeeJuiceBalance(fpc, node), node.getContract(fpc)])
	const state = published ? "instance published" : "genesis-funded, instance unpublished"
	return [
		...standard,
		pin("SponsoredFPC == pinned class at salt 0", fpc, pinned),
		check("SponsoredFPC Fee Juice (recorded)", true, `${balance} (${state})`),
	]
}

/**
 * Every privileged read-back the manifest depends on: L1 bytecode against a fresh forge build, L1 and L2 wiring, both
 * owners, class ids, network identity and the sponsor. A read that throws is a failed check, never a skipped one.
 */
export async function verifyDeployment(
	m: BridgeManifest,
	evm: BridgeEvmArtifacts,
	l1: PublicClient,
	node: AztecNode,
	l1Deployer: Address,
): Promise<Check[]> {
	const identity = await attempt("network identity", async () => {
		await assertNetworkIdentity(node, l1, m)
		return [check("network identity (node + registry → rollup)", true, `rollup version ${m.l2.rollupVersion}`)]
	})
	const deployers = new Set([m.l2.proxy.deployer, m.l2.token.deployer, m.l2.bridge.deployer])
	return [
		...identity,
		check("one L2 deployer for all instances", deployers.size === 1, [...deployers].join(", ")),
		...(await attempt("L1", () => verifyL1(l1, evm, m, l1Deployer))),
		...(await attempt("L2 instances", () => verifyInstances(node, m))),
		...(await attempt("L2 wiring", () => verifyL2Wiring(node, m))),
		...(await attempt("merchant roles", () => verifyMerchantRoles(node, m))),
		...(await attempt("environment", () => verifyEnvironment(node, m))),
	]
}

export class VerificationFailed extends Error {
	constructor(readonly failures: Check[]) {
		super(`verification failed: ${failures.map((c) => `${c.name}: ${c.detail}`).join("; ")}`)
		this.name = "VerificationFailed"
	}
}

export function assertAllPass(checks: Check[], log: (m: string) => void): void {
	for (const c of checks) log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
	const failures = checks.filter((c) => !c.ok)
	if (failures.length > 0) throw new VerificationFailed(failures)
}
