import { describe, expect, it } from "bun:test"
import { MERCHANT_MAX_DELAY, merchantStatus, TOKEN_REFUSALS } from "@inference-money/bridge-core"
import { l2Actor } from "./actors"
import { INTEGRATION } from "./harness"
import { as, asAdmin, blockTimestamp, listMerchant, merchantList, token } from "./token"

describe.skipIf(!INTEGRATION)("the merchant list", () => {
	it("[A20] only the admin lists a merchant, once and at once; the synced list and the token's view agree", async () => {
		const [m1, alice] = await Promise.all([l2Actor(), l2Actor()])
		await expect(token().methods.add_merchant!(m1).send(as(alice))).rejects.toThrow(TOKEN_REFUSALS.notAdmin)
		await listMerchant(m1)
		const list = await merchantList()
		expect(merchantStatus(list, m1)).toEqual({ merchant: true, pending: false })
		expect(merchantStatus(list, alice)).toEqual({ merchant: false, pending: false })
		const isMerchant = async (who: typeof m1) => (await token().methods.is_merchant!(who).simulate({ from: alice })).result
		expect([await isMerchant(m1), await isMerchant(alice)]).toEqual([true, false])
		await expect(listMerchant(m1)).rejects.toThrow(TOKEN_REFUSALS.alreadyAdded)
	})

	it("[A20] a switch-off waits the entry's delay, and switching back on keeps the entry marked; the synced list shows both", async () => {
		const m1 = await l2Actor()
		await listMerchant(m1)
		const { receipt } = await token().methods.schedule_merchant_off!(m1, true).send(asAdmin())
		const changeAt = (await blockTimestamp(receipt)) + MERCHANT_MAX_DELAY
		let list = await merchantList()
		expect(list.entries.get(m1.toString())).toEqual({ off: false, scheduledOff: true, changeAt })
		expect(merchantStatus(list, m1)).toEqual({ merchant: true, pending: true })
		expect(merchantStatus(list, m1, changeAt)).toEqual({ merchant: false, pending: false })
		await token().methods.schedule_merchant_off!(m1, true).send(asAdmin())
		expect((await merchantList()).entries.get(m1.toString())?.changeAt, "a repeat does not restart the clock").toBe(changeAt)
		await token().methods.schedule_merchant_off!(m1, false).send(asAdmin())
		list = await merchantList()
		expect(list.entries.get(m1.toString())).toMatchObject({ off: false, scheduledOff: false })
		expect(merchantStatus(list, m1)).toEqual({ merchant: true, pending: true })
	})
})
