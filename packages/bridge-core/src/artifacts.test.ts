import { describe, expect, it } from "bun:test"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract"
import { sponsoredFpcArtifact, tokenArtifact, tokenBridgeArtifact, tokenMinterProxyArtifact } from "./artifacts"

// The on-chain identities the deploy and every client register: a changed artifact must fail here before it ships.
describe("L2 artifacts derive their pinned class ids", () => {
	it.each([
		["TokenBridge", tokenBridgeArtifact, "0x2b818998353a1e9885f5395017cdface0f71214a0b577f0c125190ddf0313d34"],
		["TokenMinterProxy", tokenMinterProxyArtifact, "0x0d218cb0d087edd630903d41a8a963c56ec7f46a852ee1a6e31d7e9943d0d2e6"],
		["Token (merchant fork)", tokenArtifact, "0x06b1fbd1df05c85b3154d6652aeaf89f24a5129e4292b7c255ea9f6f101584a2"],
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
