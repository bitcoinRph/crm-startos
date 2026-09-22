import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

function DescriptionList({ className, ...props }: React.ComponentProps<"dl">) {
	return (
		<dl
			data-slot="description-list"
			className={cn("grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]", className)}
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
	...props
}: React.ComponentProps<"dd">) {
	return (
		<dd
			data-slot="description-details"
			className={cn("min-w-0 whitespace-pre-wrap break-words", className)}
			{...props}
		/>
	);
}

export { DescriptionDetails, DescriptionList, DescriptionTerm };
