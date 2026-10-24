import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@crm/db";
import { ImageMirrorService } from "../src/backfill/image-mirror.service";

const suffix = process.env.TEST_RUN_ID ?? "image-mirror-spec";
const service = new ImageMirrorService(db);

let dir = "";
let saved: string | undefined;
const contactIds: string[] = [];
const companyIds: string[] = [];

beforeAll(async () => {
	saved = process.env.CRM_MEDIA_DIR;
	dir = await mkdtemp(join(tmpdir(), "crm-media-"));
	process.env.CRM_MEDIA_DIR = dir;
});

afterAll(async () => {
	if (saved === undefined) delete process.env.CRM_MEDIA_DIR;
	else process.env.CRM_MEDIA_DIR = saved;
	await rm(dir, { recursive: true, force: true });
	await db.contact.deleteMany({ where: { id: { in: contactIds } } });
	await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

describe("ImageMirrorService with CRM_MEDIA_DIR", () => {
	it("does not rescan pictures that already live on our own volume", async () => {
		const before = await service.sweep();

		const contact = await db.contact.create({
			data: {
				firstName: `Local ${suffix}`,
				imageUrl: "/media/contacts-c1-0123456789ab.jpg",
			},
		});
		contactIds.push(contact.id);
		const company = await db.company.create({
			data: {
				name: `Local ${suffix}`,
				logoUrl: "/media/companies-c1-logourl-0123456789ab.png",
				iconUrl: "/media/companies-c1-iconurl-0123456789ab.png",
			},
		});
		companyIds.push(company.id);

		const after = await service.sweep();

		expect(after.scanned).toBe(before.scanned);
	});

	it("still scans a picture that lives somewhere else", async () => {
		const before = await service.sweep();

		const contact = await db.contact.create({
			data: {
				firstName: `Remote ${suffix}`,
				imageUrl: `https://cdn.invalid/${suffix}.png`,
			},
		});
		contactIds.push(contact.id);
		const company = await db.company.create({
			data: {
				name: `Remote ${suffix}`,
				logoUrl: "/media/companies-c2-logourl-0123456789ab.png",
				iconUrl: `https://cdn.invalid/${suffix}-icon.png`,
			},
		});
		companyIds.push(company.id);

		const after = await service.sweep();

		expect(after.scanned).toBe(before.scanned + 2);
	});
});
