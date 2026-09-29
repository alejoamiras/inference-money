/**
 * The L1 ABI surface bridge-core calls, hand-written so browsers never load forge artifacts. abi.test.ts pins every
 * entry to the compiled contracts (router, portal) and to @aztec-foundation/l1-artifacts (Outbox, Registry, Rollup).
 */

const PERMIT2_DEPOSIT_ROUTER_ERRORS = [
	{ type: "error", name: "AmountExceedsL2Max", inputs: [] },
	{ type: "error", name: "InexactPull", inputs: [] },
	{ type: "error", name: "NotAContract", inputs: [] },
	{ type: "error", name: "PortalNotInitialized", inputs: [] },
	{ type: "error", name: "PrivateDepositNamesRecipient", inputs: [] },
	{ type: "error", name: "PublicDepositNeedsRecipient", inputs: [] },
	{ type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
	{ type: "error", name: "ResidualBalance", inputs: [] },
	{ type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
	{ type: "error", name: "ZeroAmount", inputs: [] },
] as const

export const PERMIT2_DEPOSIT_ROUTER_ABI = [
	{
		type: "function",
		name: "deposit",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "amount", type: "uint256" },
			{ name: "aztecRecipient", type: "bytes32" },
			{ name: "secretHash", type: "bytes32" },
			{ name: "isPrivate", type: "bool" },
			{ name: "nonce", type: "uint256" },
			{ name: "deadline", type: "uint256" },
			{ name: "signature", type: "bytes" },
		],
		outputs: [
			{ name: "key", type: "bytes32" },
			{ name: "index", type: "uint256" },
		],
	},
	{
		type: "event",
		name: "Deposit",
		anonymous: false,
		inputs: [
			{ name: "depositor", type: "address", indexed: true },
			{ name: "aztecRecipient", type: "bytes32", indexed: true },
			{ name: "key", type: "bytes32", indexed: false },
			{ name: "index", type: "uint256", indexed: false },
			{ name: "amount", type: "uint256", indexed: false },
			{ name: "secretHash", type: "bytes32", indexed: false },
			{ name: "isPrivate", type: "bool", indexed: false },
		],
	},
	{ type: "function", name: "PERMIT2", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
	{ type: "function", name: "PORTAL", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
	{ type: "function", name: "TOKEN", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
	...PERMIT2_DEPOSIT_ROUTER_ERRORS,
] as const

const view = <const N extends string, const T extends string>(name: N, type: T) =>
	({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ name: "", type }] }) as const

// The portal's withdraw reverts with the Outbox's errors, so they are listed here for decoding too.
const OUTBOX_CONSUME_ERRORS = [
	{
		type: "error",
		name: "Outbox__AlreadyNullified",
		inputs: [
			{ name: "epoch", type: "uint256" },
			{ name: "leafIndex", type: "uint256" },
		],
	},
	{ type: "error", name: "Outbox__NothingToConsumeAtEpoch", inputs: [{ name: "epoch", type: "uint256" }] },
	{ type: "error", name: "Outbox__InvalidNumCheckpointsInEpoch", inputs: [{ name: "numCheckpointsInEpoch", type: "uint256" }] },
	{
		type: "error",
		name: "Outbox__LeafIndexOutOfBounds",
		inputs: [
			{ name: "leafIndex", type: "uint256" },
			{ name: "pathLength", type: "uint256" },
		],
	},
	{ type: "error", name: "Outbox__PathTooLong", inputs: [] },
	{
		type: "error",
		name: "MerkleLib__InvalidRoot",
		inputs: [
			{ name: "expected", type: "bytes32" },
			{ name: "actual", type: "bytes32" },
			{ name: "leaf", type: "bytes32" },
			{ name: "leafIndex", type: "uint256" },
		],
	},
	{ type: "error", name: "MerkleLib__InvalidIndexForPathLength", inputs: [] },
] as const

export const TOKEN_PORTAL_ABI = [
	{
		type: "function",
		name: "withdraw",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "_recipient", type: "address" },
			{ name: "_amount", type: "uint256" },
			{ name: "_withCaller", type: "bool" },
			{ name: "_epoch", type: "uint256" },
			{ name: "_numCheckpointsInEpoch", type: "uint256" },
			{ name: "_leafIndex", type: "uint256" },
			{ name: "_path", type: "bytes32[]" },
		],
		outputs: [],
	},
	view("registry", "address"),
	view("underlying", "address"),
	view("l2Bridge", "bytes32"),
	view("rollupVersion", "uint256"),
	view("initializer", "address"),
	view("inbox", "address"),
	view("outbox", "address"),
	{ type: "error", name: "AmountExceedsL2Max", inputs: [] },
	{ type: "error", name: "InexactTransfer", inputs: [] },
	{ type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
	...OUTBOX_CONSUME_ERRORS,
] as const

export const OUTBOX_ABI = [
	{
		type: "function",
		name: "getRoots",
		stateMutability: "view",
		inputs: [{ name: "_epoch", type: "uint256" }],
		outputs: [{ name: "", type: "bytes32[32]" }],
	},
	{
		type: "function",
		name: "hasMessageBeenConsumedAtEpoch",
		stateMutability: "view",
		inputs: [
			{ name: "_epoch", type: "uint256" },
			{ name: "_leafId", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		type: "event",
		name: "MessageConsumed",
		inputs: [
			{ name: "epoch", type: "uint256", indexed: true },
			{ name: "root", type: "bytes32", indexed: true },
			{ name: "messageHash", type: "bytes32", indexed: true },
			{ name: "leafId", type: "uint256", indexed: false },
			{ name: "numCheckpointsInEpoch", type: "uint256", indexed: false },
		],
	},
] as const

export const REGISTRY_ABI = [view("getCanonicalRollup", "address")] as const

export const ROLLUP_ABI = [view("getInbox", "address"), view("getOutbox", "address"), view("getVersion", "uint256")] as const
