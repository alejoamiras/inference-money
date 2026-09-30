import { describe, expect, it } from "bun:test"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract"
import { sponsoredFpcArtifact, tokenArtifact, tokenBridgeArtifact, tokenMinterProxyArtifact } from "./artifacts"

// The on-chain identities the deploy and every client register: a changed artifact must fail here before it ships.
describe("L2 artifacts derive their pinned class ids", () => {
	it.each([
		["TokenBridge", tokenBridgeArtifact, "0x2e9ade2e46ce9a9c138ec2743d3b502615a7ff67248c3dfc9fa6e8538c6196a3"],
		["TokenMinterProxy", tokenMinterProxyArtifact, "0x18d06d3b9dd7816fa9d5c3de6fca14556389405e021bfb4ad0f1b9995078af94"],
		["Token (aztec-standards 6.0.0-rc.1)", tokenArtifact, "0x24c34002788720c941a327a20c369b12c8bdcff3b5a974673a8f618763471505"],
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
