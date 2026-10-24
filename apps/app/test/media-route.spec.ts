import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "../app/media/[name]/route";

const PNG = "contacts-c1-0123456789ab.png";
const SVG = "companies-c1-logourl-0123456789ab.svg";

let dir = "";
let saved: string | undefined;

function get(name: string): Promise<Response> {
	return GET(new Request(`http://crm.local/media/${name}`), {
		params: Promise.resolve({ name }),
	});
}

beforeEach(async () => {
	saved = process.env.CRM_MEDIA_DIR;
	dir = await mkdtemp(join(tmpdir(), "crm-media-"));
	process.env.CRM_MEDIA_DIR = dir;
	await writeFile(join(dir, PNG), "png-bytes");
	await writeFile(join(dir, SVG), "<svg xmlns='http://www.w3.org/2000/svg'/>");
	await writeFile(join(dir, "secret.txt"), "secret");
});

afterEach(async () => {
	if (saved === undefined) delete process.env.CRM_MEDIA_DIR;
	else process.env.CRM_MEDIA_DIR = saved;
	await rm(dir, { recursive: true, force: true });
});

describe("GET /media/[name]", () => {
	it("serves a stored picture with its type and caching headers", async () => {
		const response = await get(PNG);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("png-bytes");
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toBeNull();
	});

	it("sandboxes an svg", async () => {
		const response = await get(SVG);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/svg+xml");
		expect(response.headers.get("content-security-policy")).toBe(
			"default-src 'none'; style-src 'unsafe-inline'; sandbox",
		);
	});

	it("answers 404 to a traversal, an unknown name or a file that is not a key", async () => {
		for (const name of [
			"../secret.txt",
			"..%2Fsecret.txt",
			"secret.txt",
			"contacts-c2-0123456789ab.png",
			`${PNG}.tmp`,
		]) {
			const response = await get(name);

			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("secret");
		}
	});

	it("answers 404 when the install keeps no pictures on a volume", async () => {
		delete process.env.CRM_MEDIA_DIR;

		expect((await get(PNG)).status).toBe(404);
	});
});
