/** L2 actors from the run's sidecar and fresh L1 keys on its anvil: every account a test touches is created for it. */
import { createPublicClient, type Hex, http } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Seed } from "../test-wallet/profile"

export interface Actor {
	seed: Seed
	address: string
}

export async function newActors(sidecarUrl: string, count: number): Promise<Actor[]> {
	const res = await fetch(`${sidecarUrl}/actors`, { method: "POST", body: JSON.stringify({ count }) })
	if (!res.ok) throw new Error(`sidecar refused ${count} actors: ${res.status} ${await res.text()}`)
	const { actors } = (await res.json()) as { actors: { secret: Hex; signingKey: Hex; address: string }[] }
	return actors.map((a) => ({ seed: { secret: a.secret, signingKey: a.signingKey }, address: a.address }))
}

/** A never-used anvil key holding gas money. */
export async function newL1Key(anvilUrl: string): Promise<Hex> {
	const key = generatePrivateKey()
	const client = createPublicClient({ transport: http(anvilUrl) })
	await client.request({
		method: "anvil_setBalance" as never,
		params: [privateKeyToAccount(key).address, "0x56bc75e2d63100000"] as never,
	})
	return key
}
