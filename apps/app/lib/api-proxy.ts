import { connection } from "next/server";
import {
	downstreamResponseHeaders,
	isProxiedPath,
	upstreamRequestHeaders,
} from "@/lib/api-proxy-request";
import { bufferedProxyResponse } from "@/lib/api-proxy-response";
import { API_URL } from "@/lib/env";

export async function proxyToApi(request: Request): Promise<Response> {
	await connection();

	const url = new URL(request.url);
	if (!isProxiedPath(url.pathname))
		return Response.json({ error: "Not found." }, { status: 404 });
	const target = `${API_URL}${url.pathname}${url.search}`;

	const init: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers: upstreamRequestHeaders(request.headers),
		redirect: "manual",
	};

	if (request.method !== "GET" && request.method !== "HEAD") {
		init.body = request.body;
		init.duplex = "half";
	}

	let upstream: Response;

	try {
		upstream = await fetch(target, init);
	} catch (error) {
		console.error(
			`API proxy: ${API_URL} is not reachable for ${request.method} ${url.pathname}.`,
			error,
		);

		return Response.json(
			{ error: `The API at ${API_URL} is not reachable.` },
			{ status: 502 },
		);
	}

	const responseHeaders = downstreamResponseHeaders(upstream.headers);

	if (
		upstream.headers.get("content-type")?.includes("text/event-stream") ||
		upstream.headers.has("content-disposition")
	) {
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	}

	return bufferedProxyResponse(upstream, responseHeaders, request.method);
}
