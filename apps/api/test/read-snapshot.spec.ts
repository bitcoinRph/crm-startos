import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { z } from "zod";
import { readSnapshot } from "../src/database/read-snapshot";

const id = `snapshot-${randomUUID()}`;

beforeEach(async () => {
	await db.company.create({ data: { id, name: "Synthetic snapshot" } });
});

afterEach(async () => {
	await db.company.deleteMany({ where: { id } });
});

describe("read-only snapshot", () => {
	it("S0 rejects writes with SQLSTATE 25006 and leaves the row unchanged", async () => {
		const before = await db.company.findUniqueOrThrow({ where: { id } });
		let failure: unknown;
		try {
			await readSnapshot(db, async (tx) => {
				await tx.$executeRaw`UPDATE "company" SET "name" = 'Forbidden' WHERE "id" = ${id}`;
			});
		} catch (error) {
			failure = error;
		}
		expect(
			z
				.object({
					meta: z.object({
						driverAdapterError: z.object({
							cause: z.object({ originalCode: z.literal("25006") }),
						}),
					}),
				})
				.parse(failure).meta.driverAdapterError.cause.originalCode,
		).toBe("25006");
		expect(await db.company.findUniqueOrThrow({ where: { id } })).toEqual(
			before,
		);
	});

	it("uses one repeatable-read snapshot while another connection commits", async () => {
		await readSnapshot(db, async (tx) => {
			const settings = z
				.array(
					z.object({
						transaction_read_only: z.literal("on"),
						transaction_isolation: z.literal("repeatable read"),
					}),
				)
				.parse(
					await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS transaction_read_only, current_setting('transaction_isolation') AS transaction_isolation`,
				);
			expect(settings).toHaveLength(1);
			const before = await tx.company.findUniqueOrThrow({ where: { id } });
			await db.company.update({
				where: { id },
				data: { name: "Concurrent fixture change" },
			});
			expect(await tx.company.findUniqueOrThrow({ where: { id } })).toEqual(
				before,
			);
		});
		expect((await db.company.findUniqueOrThrow({ where: { id } })).name).toBe(
			"Concurrent fixture change",
		);
	});
});
