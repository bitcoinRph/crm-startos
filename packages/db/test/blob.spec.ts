import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const puts: { key: string; contentType: string }[] = [];

mock.module("@vercel/blob", () => ({
	put: async (
		key: string,
		_bytes: Buffer,
		options: { contentType: string },
	) => {
		puts.push({ key, contentType: options.contentType });
		return { url: `https://store.public.blob.vercel-storage.com/${key}` };
	},
}));

const { isMirrored, isOptimizable, mirror, mirrorEnabled } = await import(
	"../src/blob"
);

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const DIGEST = createHash("sha256").update(PNG).digest("hex").slice(0, 12);

function serve(bytes: Buffer, type: string, calls: string[] = []) {
	return async (url: string) => {
		calls.push(url);
		return {
			response: new Response(bytes, { headers: { "content-type": type } }),
			url: new URL(url),
		};
	};
}

const KEYS = ["CRM_MEDIA_DIR", "BLOB_READ_WRITE_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";

beforeEach(async () => {
	for (const key of KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	dir = await mkdtemp(join(tmpdir(), "crm-media-"));
	puts.length = 0;
});

afterEach(async () => {
	for (const key of KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	await rm(dir, { recursive: true, force: true });
});

describe("mirror on the server's own volume", () => {
	it("writes the bytes under the content-hash key and returns our own path", async () => {
		process.env.CRM_MEDIA_DIR = dir;

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/AbC123",
			serve(PNG, "image/png"),
		);

		expect(stored).toBe(`/media/contacts-abc123-${DIGEST}.png`);
		expect(await readFile(join(dir, `contacts-abc123-${DIGEST}.png`))).toEqual(
			PNG,
		);
		expect(isMirrored(stored)).toBe(true);
		expect(isOptimizable(stored)).toBe(true);
	});

	it("creates the directory when it does not exist yet", async () => {
		process.env.CRM_MEDIA_DIR = join(dir, "nested", "media");

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"users/u1/avatar",
			serve(PNG, "image/png"),
		);

		expect(stored).toBe(`/media/users-u1-avatar-${DIGEST}.png`);
	});

	it("gives the same content the same key and leaves no temporary file", async () => {
		process.env.CRM_MEDIA_DIR = dir;

		const first = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(PNG, "image/png"),
		);
		const second = await mirror(
			"https://other.example.com/b.png?x=1",
			"contacts/c1",
			serve(PNG, "image/png"),
		);

		expect(second).toBe(first);
		expect(await readdir(dir)).toEqual([`contacts-c1-${DIGEST}.png`]);
	});

	it("keeps a changed picture under a new key", async () => {
		process.env.CRM_MEDIA_DIR = dir;
		const other = Buffer.concat([PNG, Buffer.from([1])]);

		const first = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(PNG, "image/png"),
		);
		const second = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(other, "image/png"),
		);

		expect(second).not.toBe(first);
		expect(await readdir(dir)).toHaveLength(2);
	});

	it("does not fetch again for a path it already minted", async () => {
		process.env.CRM_MEDIA_DIR = dir;
		const calls: string[] = [];

		const stored = await mirror(
			`/media/contacts-c1-${DIGEST}.png`,
			"contacts/c1",
			serve(PNG, "image/png", calls),
		);

		expect(stored).toBe(`/media/contacts-c1-${DIGEST}.png`);
		expect(calls).toEqual([]);
	});

	it("refuses a content type that is not a picture", async () => {
		process.env.CRM_MEDIA_DIR = dir;

		const stored = await mirror(
			"https://cdn.example.com/a.html",
			"contacts/c1",
			serve(Buffer.from("<script>1</script>"), "text/html"),
		);

		expect(stored).toBeNull();
		expect(await readdir(dir)).toEqual([]);
	});

	it("returns null when the write fails", async () => {
		const blocker = join(dir, "file");
		await writeFile(blocker, "x");
		process.env.CRM_MEDIA_DIR = join(blocker, "media");

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(PNG, "image/png"),
		);

		expect(stored).toBeNull();
	});

	it("returns null when the source cannot be fetched", async () => {
		process.env.CRM_MEDIA_DIR = dir;

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			async () => null,
		);

		expect(stored).toBeNull();
	});

	it("ignores a directory that is not absolute", async () => {
		process.env.CRM_MEDIA_DIR = "media";
		await mkdir(dir, { recursive: true });

		expect(mirrorEnabled()).toBe(false);
		expect(
			await mirror(
				"https://cdn.example.com/a.png",
				"contacts/c1",
				serve(PNG, "image/png"),
			),
		).toBeNull();
	});
});

describe("mirror on Vercel Blob", () => {
	it("is chosen when only the token is set", async () => {
		process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(PNG, "image/png"),
		);

		expect(mirrorEnabled()).toBe(true);
		expect(puts).toEqual([
			{ key: `contacts/c1-${DIGEST}.png`, contentType: "image/png" },
		]);
		expect(stored).toBe(
			`https://store.public.blob.vercel-storage.com/contacts/c1-${DIGEST}.png`,
		);
	});

	it("loses to the volume when both are set", async () => {
		process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
		process.env.CRM_MEDIA_DIR = dir;

		const stored = await mirror(
			"https://cdn.example.com/a.png",
			"contacts/c1",
			serve(PNG, "image/png"),
		);

		expect(puts).toEqual([]);
		expect(stored).toBe(`/media/contacts-c1-${DIGEST}.png`);
	});
});

describe("mirrorEnabled", () => {
	it("is off with neither backend configured", () => {
		expect(mirrorEnabled()).toBe(false);
	});

	it("is on with only the volume", () => {
		process.env.CRM_MEDIA_DIR = dir;
		expect(mirrorEnabled()).toBe(true);
	});

	it("treats a blank value as unset", () => {
		process.env.CRM_MEDIA_DIR = "   ";
		process.env.BLOB_READ_WRITE_TOKEN = "  ";
		expect(mirrorEnabled()).toBe(false);
	});
});
