import { mediaDir, readMedia } from "@crm/db/media";

const SVG_SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ name: string }> },
): Promise<Response> {
	const { name } = await params;
	const dir = mediaDir();
	const media = dir ? await readMedia(dir, name) : null;

	if (!media) return notFound();

	const headers = new Headers({
		"content-type": media.type,
		"content-length": String(media.bytes.byteLength),
		"cache-control": "public, max-age=31536000, immutable",
		"x-content-type-options": "nosniff",
	});
	if (media.type === "image/svg+xml") {
		headers.set("content-security-policy", SVG_SANDBOX);
	}

	return new Response(new Uint8Array(media.bytes), { headers });
}

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}
