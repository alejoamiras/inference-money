/**
 * EIP-712 typed data for `TokenPortal.depositToAztecPrivate`, the portal's signed path. The type string and domain must
 * match the portal's byte for byte; funding-authorization.test.ts pins them to the same literals as
 * contracts/evm/test/FundingAuthorization.t.sol. Only `submitter` may send the signed deposit, and the portal pulls the
 * USDC from it with `transferFrom`, so the submitter approves the portal first.
 */
import { type Address, type Hex, keccak256, toHex } from "viem"

export const FUNDING_AUTHORIZATION_TYPE =
	"FundingAuthorization(address depositor,address submitter,uint256 amount,bytes32 secretHash,uint256 deadline)"
export const FUNDING_AUTHORIZATION_TYPEHASH = keccak256(toHex(FUNDING_AUTHORIZATION_TYPE))

export const FUNDING_AUTHORIZATION_TYPES = {
	FundingAuthorization: [
		{ name: "depositor", type: "address" },
		{ name: "submitter", type: "address" },
		{ name: "amount", type: "uint256" },
		{ name: "secretHash", type: "bytes32" },
		{ name: "deadline", type: "uint256" },
	],
} as const

export interface FundingAuthorization {
	/** The signer: the message names it, the claim binds to it, and a return pays it. */
	depositor: Address
	/** The only caller the portal accepts the signature from. */
	submitter: Address
	amount: bigint
	secretHash: Hex
	/** Unix seconds; the portal refuses once `block.timestamp` is past it. */
	deadline: bigint
}

export function fundingAuthorizationTypedData(a: FundingAuthorization, portal: Address, chainId: number) {
	return {
		domain: { name: "InferenceMoneyTokenPortal", version: "1", chainId, verifyingContract: portal },
		types: FUNDING_AUTHORIZATION_TYPES,
		primaryType: "FundingAuthorization" as const,
		message: a,
	}
}
