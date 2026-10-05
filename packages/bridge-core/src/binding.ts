import { AztecAddress, type EthAddress } from "@aztec-labs/aztec.js/addresses"
import { Contract } from "@aztec-labs/aztec.js/contracts"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import { type Address, isAddressEqual } from "viem"
import { tokenBridgeArtifact } from "./artifacts"
import type { BridgeManifest } from "./manifest"

/**
 * The Ethereum address `owner`'s account is bound to, or undefined until its first private claim binds it. Reads
 * `owner`'s own notes, so only a wallet holding its keys can answer.
 */
export async function fundingAddress(wallet: Wallet, m: BridgeManifest, owner: AztecAddress): Promise<Address | undefined> {
	const bridge = Contract.at(AztecAddress.fromStringUnsafe(m.l2.bridge.address), tokenBridgeArtifact, wallet)
	const { result } = await bridge.methods.get_funding_address!(owner).simulate({ from: owner })
	const address = result as EthAddress
	return address.isZero() ? undefined : (address.toString() as Address)
}

/** A private deposit from another address than the account's funding address: it can only go back to its sender. */
export class NotFundingAddressError extends Error {
	constructor(
		readonly fundingAddress: Address,
		readonly depositor: Address,
	) {
		super(
			`This deposit came from ${depositor}, but the account takes deposits only from ${fundingAddress}. Return it to its sender instead.`,
		)
		this.name = "NotFundingAddressError"
	}
}

/** Claiming would bind an unbound account for good, and the caller did not pass `allowBind`; nothing was simulated or sent. */
export class BindConsentRequiredError extends Error {
	constructor(
		readonly recipient: AztecAddress,
		readonly depositor: Address,
	) {
		super(
			`Claiming this deposit binds ${recipient}, for good, to ${depositor}, the address it came from. Claim with allowBind once its owner agrees.`,
		)
		this.name = "BindConsentRequiredError"
	}
}

/**
 * What claiming a private deposit from `depositor` into `recipient` does to the account: "binds" on its first claim,
 * which ties it to `depositor` for good, "matches" once it is bound there. A deposit from any other address throws
 * {@link NotFundingAddressError}. Reads `recipient`'s notes, so `wallet` must hold its keys.
 */
export async function claimBinding(
	wallet: Wallet,
	m: BridgeManifest,
	recipient: AztecAddress,
	depositor: Address,
): Promise<"binds" | "matches"> {
	const bound = await fundingAddress(wallet, m, recipient)
	if (bound === undefined) return "binds"
	if (isAddressEqual(bound, depositor)) return "matches"
	throw new NotFundingAddressError(bound, depositor)
}

/** A user account withdraws only to its funding address; nothing was burned. */
export class ExitDestinationError extends Error {
	constructor(
		readonly fundingAddress: Address | undefined,
		readonly recipient: Address,
	) {
		super(
			fundingAddress === undefined
				? "This account has no funding address yet, so it cannot withdraw. Its first private claim sets one."
				: `This account withdraws only to its funding address ${fundingAddress}, not ${recipient}.`,
		)
		this.name = "ExitDestinationError"
	}
}

/** Refuses a user's private exit to anything but its funding address, before any witness or burn. */
export async function assertExitDestination(wallet: Wallet, m: BridgeManifest, from: AztecAddress, recipient: Address): Promise<void> {
	const bound = await fundingAddress(wallet, m, from)
	if (bound === undefined || !isAddressEqual(bound, recipient)) throw new ExitDestinationError(bound, recipient)
}
