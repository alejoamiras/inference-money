import { describe, expect, it } from "bun:test"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract"
import { sponsoredFpcArtifact, tokenArtifact, tokenBridgeArtifact, tokenMinterProxyArtifact } from "./artifacts"

// The on-chain identities the deploy and every client register: a changed artifact must fail here before it ships.
describe("L2 artifacts derive their pinned class ids", () => {
	it.each([
		["TokenBridge", tokenBridgeArtifact, "0x29d62ee5aa57d9a791e672b80c17d68d5320b8a4e7273f501a980d45f6f42d2b"],
		["TokenMinterProxy", tokenMinterProxyArtifact, "0x0d218cb0d087edd630903d41a8a963c56ec7f46a852ee1a6e31d7e9943d0d2e6"],
		["Token (merchant fork)", tokenArtifact, "0x0a1c52d7c23324567f60e817022467335af1c77d52c69e7751109411f73b87a5"],
	] as const)("%s", async (_, artifact, classId) => {
		expect((await getContractClassFromArtifact(artifact)).id.toString()).toBe(classId)
	})

	// The address the testnet publishes and a local network funds at genesis.
	it("SponsoredFPC derives the canonical sponsor at salt 0", async () => {
		const instance = await getContractInstanceFromInstantiationParams(sponsoredFpcArtifact, { salt: Fr.ZERO })
		expect(instance.currentContractClassId.toString()).toBe("0x2f85ee9e617266fd46d41e4f57a6209c52ab07114cf0fe154f13fc903da8f433")
		expect(instance.address.toString()).toBe("0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b")
	})
})
