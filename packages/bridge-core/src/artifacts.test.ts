import { describe, expect, it } from "bun:test"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { tokenArtifact, tokenBridgeArtifact, tokenMinterProxyArtifact } from "./artifacts"

// The on-chain identities the deploy and every client register: a changed artifact must fail here before it ships.
describe("L2 artifacts derive their pinned class ids", () => {
	it.each([
		["TokenBridge", tokenBridgeArtifact, "0x2cb5c6341bbae9bb0e78b64cfdd724cb493cc35dca46b122280fdf223b3d8713"],
		["TokenMinterProxy", tokenMinterProxyArtifact, "0x07689a539bf0a60a252f9b88406d5a4b129f192f7da37ab181c7a2be6910524a"],
		["Token (aztec-standards 5.0.1)", tokenArtifact, "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf"],
	] as const)("%s", async (_, artifact, classId) => {
		expect((await getContractClassFromArtifact(artifact)).id.toString()).toBe(classId)
	})
})
