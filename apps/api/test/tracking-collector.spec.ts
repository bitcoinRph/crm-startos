import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";
import { TrackingIngestService } from "../src/tracking/tracking-ingest.service";

type JsonBody = z.infer<ReturnType<typeof z.json>>;

describe("Tracking collector", () => {
	let app: INestApplication;
	let accept: ReturnType<typeof spyOn<TrackingIngestService, "accept">>;

	const SITE_ID = "cmp_1234abcd";

	const view = {
		type: "page_view",
		host: "example.com",
		path: "/pricing",
		at: 1_700_000_000_000,
	};

	const send = (body: JsonBody) =>
		request(app.getHttpServer())
			.post("/api/t/e")
			.set("origin", "https://example.com")
			.set("content-type", "text/plain")
			.send(JSON.stringify(body));

	beforeAll(async () => {
		const { createApp } = await import("../src/create-app");

		app = await createApp();
		await app.init();

		accept = spyOn(
			app.get(TrackingIngestService),
			"accept",
		).mockResolvedValue();
	});

	afterEach(() => {
		accept.mockClear();
	});

	afterAll(async () => {
		await app.close();
	});

	it("answers a beacon from another origin with a cross-origin CORP", async () => {
		const response = await request(app.getHttpServer())
			.post("/api/t/e")
			.set("origin", "https://example.com")
			.set("content-type", "text/plain")
			.send(JSON.stringify({ siteId: "cmp_unknown", events: [] }));

		expect(response.status).toBe(204);
		expect(response.headers["cross-origin-resource-policy"]).toBe(
			"cross-origin",
		);
	});

	it("hands a valid batch to the ingest service", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [view],
		});

		expect(response.status).toBe(204);
		expect(accept).toHaveBeenCalledTimes(1);
		expect(accept.mock.calls[0]?.[0]).toEqual({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [view],
		});
	});

	it("strips fields the tracker never sends and still accepts the batch", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			extra: "ignored",
			events: [{ ...view, surprise: 1, touch: { landing: "/", extra: true } }],
		});

		expect(response.status).toBe(204);
		expect(accept.mock.calls[0]?.[0]).toEqual({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [{ ...view, touch: { landing: "/" } }],
		});
	});

	it("ignores a batch whose site id is a number", async () => {
		const response = await send({
			siteId: 12345678,
			visitorId: "visitor12345",
			events: [view],
		});

		expect(response.status).toBe(204);
		expect(accept).not.toHaveBeenCalled();
	});

	it("ignores a batch whose events are not an array", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: view,
		});

		expect(response.status).toBe(204);
		expect(accept).not.toHaveBeenCalled();
	});

	it("ignores a batch with an event whose type is a number", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [{ ...view, type: 7 }],
		});

		expect(response.status).toBe(204);
		expect(accept).not.toHaveBeenCalled();
	});

	it("ignores a batch with an event whose path is a number", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [{ ...view, path: 42 }],
		});

		expect(response.status).toBe(204);
		expect(accept).not.toHaveBeenCalled();
	});

	it("ignores a batch with an event whose fields are not text", async () => {
		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [{ ...view, type: "form_submit", fields: 5 }],
		});

		expect(response.status).toBe(204);
		expect(accept).not.toHaveBeenCalled();
	});

	it("keeps a form submission whose firstTouch is malformed", async () => {
		const submit = {
			...view,
			type: "form_submit",
			fields: { email: "dana@acme.test" },
			touch: { landing: "/" },
		};

		const response = await send({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [{ ...submit, firstTouch: { landing: 5, at: "yesterday" } }],
		});

		expect(response.status).toBe(204);
		expect(accept).toHaveBeenCalledTimes(1);
		expect(accept.mock.calls[0]?.[0]).toEqual({
			siteId: SITE_ID,
			visitorId: "visitor12345",
			events: [submit],
		});
	});
});
