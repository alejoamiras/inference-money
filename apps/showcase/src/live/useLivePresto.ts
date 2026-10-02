import { useEffect, useMemo, useState } from "react"
import type { PagePresto, PrestoConsent } from "@/presto"
import type { LivePresto } from "./LiveMode"

/** The visitor is asked about Presto only while "Try it yourself" is open; leaving it keeps every later proof in the page. */
export function useLivePresto(presto: PagePresto | undefined): LivePresto | undefined {
	const [consent, setConsent] = useState<PrestoConsent>()
	useEffect(() => {
		if (!presto) return
		const asked = presto.ask()
		setConsent(asked)
		return () => {
			asked.stop()
			setConsent(undefined)
		}
	}, [presto])
	return useMemo(() => (presto && consent ? { consent, proof: presto.proofs.proof } : undefined), [presto, consent])
}
