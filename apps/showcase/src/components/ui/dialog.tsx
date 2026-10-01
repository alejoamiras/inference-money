import { Dialog as D } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/cn"

export interface DialogProps {
	readonly open: boolean
	/** Called for Escape, an outside click and the close button alike. */
	readonly onDismiss: () => void
	readonly title: string
	readonly description?: ReactNode
	readonly children: ReactNode
	readonly testId?: string
	readonly className?: string
}

export function Dialog({ open, onDismiss, title, description, children, testId, className }: DialogProps) {
	return (
		<D.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
			<D.Portal>
				<D.Overlay className="fixed inset-0 z-40 bg-black/50" />
				<D.Content
					data-testid={testId}
					className={cn(
						"fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-lg",
						className,
					)}
					// Radix links a Description by default; a dialog without one opts out explicitly.
					{...(description ? {} : { "aria-describedby": undefined })}
				>
					<D.Title className="text-lg font-semibold">{title}</D.Title>
					{description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : null}
					{children}
				</D.Content>
			</D.Portal>
		</D.Root>
	)
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}
