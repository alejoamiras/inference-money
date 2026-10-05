import { describe, expect, it } from "bun:test"
import { type Address, domainSeparator, hashStruct, hashTypedData } from "viem"
import {
	FUNDING_AUTHORIZATION_TYPE,
	FUNDING_AUTHORIZATION_TYPEHASH,
	FUNDING_AUTHORIZATION_TYPES,
	type FundingAuthorization,
	fundingAuthorizationTypedData,
} from "./funding-authorization"

// The literals of contracts/evm/test/FundingAuthorization.t.sol, computed there independently with `cast`.
const TYPEHASH = "0x924f4fb07f90fde04f0315fd46473842575243fa10abea2fd2e81cfd638988b2"
const DOMAIN_SEPARATOR = "0x8eec773379b24598bae1f2fbbacc4f05aa161eecc18d04825b8eb10809a537b9"
const STRUCT_HASH = "0xc06af54fed5e0d3950a5f227e12c29d6ce4bbd7c36bd3c9602b3cef6940938e9"
const DIGEST = "0x42cea5f37760a9570292bd193b1fc9f71e1b06fa75fa2eb7005c9367569eacbc"

const PORTAL: Address = "0x00000000000000000000000000000000000f0F7a"
const CHAIN_ID = 31_337
const AUTH: FundingAuthorization = {
	depositor: "0x1111111111111111111111111111111111111111",
	submitter: "0x2222222222222222222222222222222222222222",
	amount: 1_000_000n,
	secretHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
	deadline: 1_800_000_000n,
}

describe("FundingAuthorization typed data equals the portal's", () => {
	it("type string and typehash", () => {
		expect(FUNDING_AUTHORIZATION_TYPEHASH).toBe(TYPEHASH)
		expect(FUNDING_AUTHORIZATION_TYPE).toBe(
			"FundingAuthorization(address depositor,address submitter,uint256 amount,bytes32 secretHash,uint256 deadline)",
		)
	})

	it("domain separator, struct hash and digest", () => {
		const td = fundingAuthorizationTypedData(AUTH, PORTAL, CHAIN_ID)
		expect(domainSeparator({ domain: td.domain })).toBe(DOMAIN_SEPARATOR)
		expect(hashStruct({ data: td.message, primaryType: td.primaryType, types: FUNDING_AUTHORIZATION_TYPES })).toBe(STRUCT_HASH)
		expect(hashTypedData(td)).toBe(DIGEST)
	})

	it("every field moves the digest", () => {
		const other = "0x4444444444444444444444444444444444444444" as const
		const variants: FundingAuthorization[] = [
			{ ...AUTH, depositor: other },
			{ ...AUTH, submitter: other },
			{ ...AUTH, amount: AUTH.amount + 1n },
			{ ...AUTH, secretHash: `0x${"44".repeat(32)}` },
			{ ...AUTH, deadline: AUTH.deadline + 1n },
		]
		for (const v of variants) expect(hashTypedData(fundingAuthorizationTypedData(v, PORTAL, CHAIN_ID))).not.toBe(DIGEST)
		expect(hashTypedData(fundingAuthorizationTypedData(AUTH, other, CHAIN_ID))).not.toBe(DIGEST)
		expect(hashTypedData(fundingAuthorizationTypedData(AUTH, PORTAL, 1))).not.toBe(DIGEST)
	})
})
