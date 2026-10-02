import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight";
import { Badge } from "@crm/ui/components/badge";
import { Icon } from "@crm/ui/components/icon";
import type * as React from "react";

function EgressBadge({
	destination,
	detail,
	...props
}: Omit<React.ComponentProps<typeof Badge>, "variant" | "children"> & {
	destination: string;
	detail?: string;
}) {
	return (
		<Badge
			data-slot="egress-badge"
			variant="outline"
			title={detail ?? `What you send here goes to ${destination}.`}
			{...props}
		>
			<Icon icon={ArrowUpRight} data-icon="inline-start" />
			Sends to {destination}
		</Badge>
	);
}

export { EgressBadge };
