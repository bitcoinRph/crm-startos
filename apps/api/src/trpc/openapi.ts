import type { AnyTRPCProcedure, AnyTRPCRouter } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z } from "zod";

export const REST_BRIDGE_PATH = "/rest";

export type RestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export function restMeta(
	method: RestMethod,
	path: `/${string}`,
	tags: string[],
	options: { protect?: boolean } = {},
): OpenApiMeta {
	return {
		openapi: {
			method,
			path,
			tags,
			protect: options.protect ?? true,
		},
	};
}

const restPathMeta = z.object({
	openapi: z.object({ path: z.string() }),
});

function segmentKinds(procedure: AnyTRPCProcedure) {
	const parsed = restPathMeta.safeParse(procedure._def.meta);
	if (!parsed.success) return [];
	return parsed.data.openapi.path
		.split("/")
		.filter(Boolean)
		.map((segment) => (segment.startsWith("{") ? 1 : 0));
}

function compareSegmentKinds(left: number[], right: number[]) {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference) return difference;
	}
	return left.length - right.length;
}

export function restBridgeRouter<TRouter extends AnyTRPCRouter>(
	router: TRouter,
): TRouter {
	const record: Record<string, AnyTRPCProcedure> = router._def.procedures;
	const procedures = Object.entries(record)
		.map(([path, procedure]) => ({
			path,
			procedure,
			kinds: segmentKinds(procedure),
		}))
		.sort((left, right) => compareSegmentKinds(left.kinds, right.kinds))
		.map(({ path, procedure }) => [path, procedure] as const);
	return {
		...router,
		_def: { ...router._def, procedures: Object.fromEntries(procedures) },
	};
}
