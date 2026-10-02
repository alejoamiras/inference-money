import type { ReactNode } from "react"

/** The wallets' side on the left (a notice, composer, stage, verdict), the public chains' side on the right. */
export function Layout(p: {
	header: ReactNode
	notice?: ReactNode
	composer: ReactNode
	stage: ReactNode
	verdict: ReactNode
	feed: ReactNode
}) {
	return (
		<div className="flex min-h-screen flex-col">
			{p.header}
			<div className="flex grow flex-col lg:flex-row">
				<main className="flex min-w-0 flex-col gap-3.5 p-4 lg:w-[860px] lg:shrink-0 lg:px-6 lg:py-[18px]">
					{p.notice}
					{p.composer}
					{p.stage}
					{p.verdict}
				</main>
				{p.feed}
			</div>
		</div>
	)
}
