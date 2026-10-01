import type { ComponentProps } from "react"
import { tv, type VariantProps } from "tailwind-variants"

export const button = tv({
	base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground hover:bg-primary/90",
			outline: "border border-border bg-background hover:bg-muted",
			ghost: "hover:bg-muted",
			destructive: "bg-destructive text-white hover:bg-destructive/90",
		},
		size: {
			default: "h-9 px-4",
			sm: "h-8 px-3 text-xs",
			lg: "h-10 px-6",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
})

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
	return <button type={type} className={button({ variant, size, className })} {...props} />
}
