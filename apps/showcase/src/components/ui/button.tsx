import type { ComponentProps } from "react"
import { tv, type VariantProps } from "tailwind-variants"

export const button = tv({
	base: "inline-flex h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-usdc disabled:cursor-default disabled:opacity-50",
	variants: {
		variant: {
			default: "bg-usdc text-white hover:bg-usdc-ink",
			outline: "border border-line bg-white text-ink hover:bg-idle-soft",
		},
	},
	defaultVariants: { variant: "default" },
})

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>

export function Button({ className, variant, type = "button", ...props }: ButtonProps) {
	return <button type={type} className={button({ variant, className })} {...props} />
}
