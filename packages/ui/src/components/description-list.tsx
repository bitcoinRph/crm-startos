import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

function DescriptionList({
	className,
	size = "default",
	...props
}: React.ComponentProps<"dl"> & { size?: "default" | "sm" }) {
	return (
		<dl
			data-slot="description-list"
			data-size={size}
			className={cn(
				"grid gap-x-4 gap-y-2 text-sm data-[size=sm]:gap-y-1 data-[size=sm]:text-xs sm:grid-cols-[max-content_1fr]",
				className,
			)}
			{...props}
		/>
	);
}

function DescriptionTerm({ className, ...props }: React.ComponentProps<"dt">) {
	return (
		<dt
			data-slot="description-term"
			className={cn("text-muted-foreground", className)}
			{...props}
		/>
	);
}

function DescriptionDetails({
	className,
	mono = false,
	...props
}: React.ComponentProps<"dd"> & { mono?: boolean }) {
	return (
		<dd
			data-slot="description-details"
			className={cn(
				"min-w-0 whitespace-pre-wrap break-words",
				mono && "font-mono",
				className,
			)}
			{...props}
		/>
	);
}

export { DescriptionDetails, DescriptionList, DescriptionTerm };
