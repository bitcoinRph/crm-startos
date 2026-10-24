const PROXIED_PATHS = ["/api", "/rest", "/openapi.json"] as const;

const HOP_BY_HOP_HEADERS = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
];

const CLIENT_ONLY_HEADERS = [
	"host",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-forwarded-for",
	"forwarded",
	"content-length",
	"expect",
];

const UPSTREAM_BODY_HEADERS = ["content-encoding", "content-length"];

export function isProxiedPath(pathname: string): boolean {
	return PROXIED_PATHS.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function withoutHeaders(source: Headers, names: readonly string[]): Headers {
	const headers = new Headers(source);
	const named = (source.get("connection") ?? "")
		.split(",")
		.map((name) => name.trim().toLowerCase())
		.filter(Boolean);
	for (const name of [...HOP_BY_HOP_HEADERS, ...names, ...named]) {
		headers.delete(name);
	}
	return headers;
}

export function upstreamRequestHeaders(source: Headers): Headers {
	return withoutHeaders(source, CLIENT_ONLY_HEADERS);
}

export function downstreamResponseHeaders(source: Headers): Headers {
	const headers = withoutHeaders(source, UPSTREAM_BODY_HEADERS);
	const cookies = source.getSetCookie();
	if (cookies.length > 0) {
		headers.delete("set-cookie");
		for (const cookie of cookies) headers.append("set-cookie", cookie);
	}
	return headers;
}

export function webOpenApiDocument<
	TPathItem,
	TDocument extends { paths: Record<string, TPathItem> },
>(document: TDocument): TDocument {
	return {
		...document,
		paths: Object.fromEntries(
			Object.entries(document.paths).filter(([path]) => isProxiedPath(path)),
		),
	};
}
