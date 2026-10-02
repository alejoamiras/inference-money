import { describe, expect, it } from "bun:test"
import { AztecAddress, EthAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract"
import { tokenArtifact, tokenBridgeArtifact } from "./artifacts"
import { instanceFromRecord, instanceRecord } from "./instances"
import { MANIFEST as M } from "./test/fixtures"

describe("instance records", () => {
	it("round-trip every constructor arg kind (address, eth address, string, u8) to the deployed address", async () => {
		const deployer = await AztecAddress.random()
		const proxy = await AztecAddress.random()
		const cases = [
			[tokenArtifact, "constructor_with_minter", ["USD Coin", "USDC", 6, proxy, AztecAddress.ZERO]],
			[tokenBridgeArtifact, "constructor", [proxy, await AztecAddress.random(), EthAddress.fromString(M.l1.portal)]],
		] as const
		for (const [artifact, initializer, args] of cases) {
			const instance = await getContractInstanceFromInstantiationParams(artifact, {
				constructorArtifact: initializer,
				constructorArgs: [...args],
				salt: Fr.random(),
				deployer,
			})
			const record = instanceRecord(instance, initializer, args)
			expect((await instanceFromRecord(artifact, record)).address.equals(instance.address)).toBe(true)
			await expect(instanceFromRecord(artifact, { ...record, salt: Fr.random().toString() as `0x${string}` })).rejects.toThrow(
				/derives/,
			)
		}
	})
})
