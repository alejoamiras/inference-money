/**
 * The deployment manifest: the one schema deployer writes and every consumer parses. Strict at every level, so a
 * stale, missing or unknown field fails loudly at write and read time instead of shipping silently.
 */
import type { Address, Hex } from "viem"
import { z } from "zod"

const evmAddress = z.custom<Address>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v), "expected a 20-byte 0x address")
const field = z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v), "expected a 32-byte lowercase 0x hex value")
const hex = z.custom<Hex>((v) => typeof v === "string" && /^0x([0-9a-f]{2})+$/.test(v), "expected lowercase 0x hex bytes")
const uint = z.number().int().nonnegative()

const l2InstanceSchema = z.strictObject({
	address: field,
	salt: field,
	/** The deploy account; aztec-nr then refuses any other initializer. Never zero (a universal deploy). */
	deployer: field,
	initializer: z.string().min(1),
	constructorArgs: z.array(z.string()),
	publicKeys: hex,
	classId: field,
})

const ZERO_FIELD: Hex = `0x${"0".repeat(64)}`

export const bridgeManifestSchema = z
	.strictObject({
		network: z.enum(["local", "testnet"]),
		l1: z.strictObject({
			chainId: uint.positive(),
			usdc: evmAddress,
			permit2: evmAddress,
			portal: evmAddress,
			router: evmAddress,
			registry: evmAddress,
			inbox: evmAddress,
			outbox: evmAddress,
			/** The first block a deposit log scan needs to read. */
			deployBlock: uint,
		}),
		l2: z.strictObject({
			nodeVersion: z.string().min(1),
			rollupVersion: uint.positive(),
			nodeUrl: z.url(),
			sponsoredFpc: field.optional(),
			proxy: l2InstanceSchema,
			token: l2InstanceSchema,
			bridge: l2InstanceSchema,
		}),
	})
	.superRefine((m, ctx) => {
		const deployers = new Set([m.l2.proxy.deployer, m.l2.token.deployer, m.l2.bridge.deployer])
		if (deployers.size !== 1 || deployers.has(ZERO_FIELD)) {
			ctx.addIssue({
				code: "custom",
				path: ["l2"],
				message: "proxy, token and bridge must share one non-zero deployer (a zero deployer lets anyone initialize first)",
			})
		}
	})

export type BridgeManifest = z.infer<typeof bridgeManifestSchema>
export type L2InstanceRecord = z.infer<typeof l2InstanceSchema>

export function parseManifest(raw: unknown): BridgeManifest {
	const result = bridgeManifestSchema.safeParse(raw)
	if (!result.success) {
		const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
		throw new Error(`bridge manifest failed validation: ${issues}`)
	}
	return result.data
}
