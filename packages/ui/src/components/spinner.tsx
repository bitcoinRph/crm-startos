import {
	LOGO_CENTER,
	LOGO_SLAB,
	logoPaths,
} from "@crm/ui/components/logo";
import { cn } from "@crm/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const spinnerVariants = cva("shrink-0", {
	variants: {
		size: {
			default: "size-4",
			lg: "size-10",
		},
	},
	defaultVariants: {
		size: "default",
	},
});

function Spinner({
	className,
	size,
	...props
}: React.ComponentProps<"svg"> & VariantProps<typeof spinnerVariants>) {
	return (
		<svg
			data-slot="spinner"
			role="status"
			aria-label="Loading"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="-7.4375 -7.4375 70.875 70.875"
			fill="none"
			className={cn(spinnerVariants({ size }), className)}
			{...props}
		>
			{logoPaths({ slabOpacity: 0.85 })}
			<path
				d={LOGO_SLAB}
				transform={`translate(${LOGO_CENTER} ${LOGO_CENTER}) scale(1.16) translate(${-LOGO_CENTER} ${-LOGO_CENTER})`}
				stroke="var(--ring)"
				strokeWidth={3.5}
				strokeLinejoin="round"
				strokeLinecap="round"
				pathLength={100}
				strokeDasharray="40 60"
				className="animate-spinner-trace motion-reduce:animate-none motion-reduce:opacity-40 motion-reduce:[stroke-dasharray:none]"
			/>
		</svg>
	);
}

export { Spinner };
