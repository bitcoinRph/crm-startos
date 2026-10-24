import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMedia } from "../src/media";

const NAME = "contacts-c1-0123456789ab.png";
let dir = "";

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "crm-media-"));
	await writeFile(join(dir, NAME), "png-bytes");
	await writeFile(join(dir, `${NAME}.tmp`), "partial");
	await writeFile(join(dir, "secret.txt"), "secret");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("readMedia", () => {
	it("reads a file by its exact key with its content type", async () => {
		const media = await readMedia(dir, NAME);

		expect(media?.type).toBe("image/png");
		expect(media?.bytes.toString()).toBe("png-bytes");
	});

	it("maps each extension to its type", async () => {
		await writeFile(join(dir, "logo-0123456789ab.svg"), "<svg/>");
		await writeFile(join(dir, "icon-0123456789ab.ico"), "ico");

		expect((await readMedia(dir, "logo-0123456789ab.svg"))?.type).toBe(
			"image/svg+xml",
		);
		expect((await readMedia(dir, "icon-0123456789ab.ico"))?.type).toBe(
			"image/x-icon",
		);
	});

	it("refuses a name that is not a key", async () => {
		for (const name of [
			"../secret.txt",
			"..%2Fsecret.txt",
			"/etc/passwd",
			"secret.txt",
			`${NAME}.tmp`,
			"a/b-0123456789ab.png",
			"A-0123456789ab.png",
			"c1-0123456789AB.png",
			"c1-0123456789a.png",
			"c1-0123456789ab.html",
			"",
		]) {
			expect(await readMedia(dir, name)).toBeNull();
		}
	});

	it("returns null for a key with no file", async () => {
		expect(await readMedia(dir, "contacts-c2-0123456789ab.png")).toBeNull();
	});
});
