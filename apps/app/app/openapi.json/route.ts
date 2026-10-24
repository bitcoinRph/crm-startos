import { z } from "zod";
import { proxyToApi } from "@/lib/api-proxy";
import { webOpenApiDocument } from "@/lib/api-proxy-request";

const openApiDocument = z.looseObject({
	paths: z.record(z.string(), z.looseObject({})),
});

export async function GET(request: Request): Promise<Response> {
	const response = await proxyToApi(request);
	if (!response.ok) return response;
	const document = openApiDocument.parse(await response.json());
	return Response.json(webOpenApiDocument(document));
}

export { proxyToApi as HEAD };
