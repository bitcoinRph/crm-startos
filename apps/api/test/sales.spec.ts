import { describe, expect, it } from "bun:test";
import type {
	Db,
	Prisma,
	SalesProposalModel as SalesProposal,
	SalesRequestModel as SalesRequest,
} from "@crm/db";
import {
	approvedSalesProfile,
	salesRequestInput,
	validateSalesOperations,
} from "@crm/validation/sales";
import {
	requireSalesScope,
	SALES_SCOPES,
	type SalesActor,
	SalesService,
} from "../src/sales/sales.service";

const actor: SalesActor = {
	kind: "session",
	userId: "human",
	sessionId: "session",
};
const reader: SalesActor = {
	kind: "apiKey",
	userId: "human",
	keyId: "key-reader",
	scopes: [SALES_SCOPES.read],
};
const writer: SalesActor = {
	kind: "apiKey",
	userId: "worker",
	keyId: "key-worker",
	scopes: [SALES_SCOPES.write],
};
const readingWriter: SalesActor = {
	...writer,
	scopes: [SALES_SCOPES.write, SALES_SCOPES.read],
};
const revision = new Date("2026-09-22T00:00:00.000Z");
const source = "Sales Director. Call next week. Met at conference.";
const operations = [
	{
		type: "contact_fact",
		contactId: "contact",
		field: "jobTitle",
		value: "Sales Director",
		evidence: "Sales Director",
	},
	{
		type: "create_task",
		contactId: "contact",
		field: null,
		value: "Call next week",
		evidence: "Call next week",
	},
	{
		type: "create_note",
		contactId: "contact",
		field: null,
		value: "Met at conference",
		evidence: "Met at conference",
	},
];
const input = {
	source,
	candidateIds: ["contact"],
	expectedUpdatedAt: revision.toISOString(),
	profileId: approvedSalesProfile.id,
	profileRevision: approvedSalesProfile.revision,
};

function fixture() {
	const state = {
		request: null as SalesRequest | null,
		proposal: null as SalesProposal | null,
		activities: [] as Prisma.ActivityUncheckedCreateInput[],
		locks: [] as string[],
		contact: {
			id: "contact",
			companyId: "company",
			firstName: "Actual",
			lastName: null,
			email: null,
			title: "Old",
			updatedAt: revision,
		},
		company: { id: "company", lastActivityAt: null as Date | null },
		session: true,
	};
	const tx = {
		$queryRaw: async (parts: TemplateStringsArray) => {
			state.locks.push(parts.join("?"));
			return [];
		},
		session: {
			findFirst: async () => (state.session ? { id: "session" } : null),
		},
		contact: {
			findFirst: async () => state.contact,
			update: async ({ data }: { data: Partial<typeof state.contact> }) =>
				Object.assign(state.contact, data),
		},
		company: {
			updateMany: async ({ data }: { data: { lastActivityAt: Date } }) =>
				Object.assign(state.company, data),
		},
		salesRequest: {
			create: async ({
				data,
			}: {
				data: Omit<SalesRequest, "error" | "createdAt">;
			}) =>
				(state.request = {
					...data,
					error: null,
					createdAt: revision,
				}),
			findUnique: async () =>
				state.request ? { ...state.request, proposal: state.proposal } : null,
			findMany: async () => [state.request],
			update: async ({ data }: { data: Partial<SalesRequest> }) => {
				if (!state.request) throw new Error("Missing request");
				return Object.assign(state.request, data);
			},
		},
		salesProposal: {
			create: async ({
				data,
			}: {
				data: Pick<
					SalesProposal,
					| "id"
					| "requestId"
					| "idempotencyKey"
					| "operations"
					| "proposedById"
					| "proposedByKeyId"
					| "producedBy"
				>;
			}) =>
				(state.proposal = {
					...data,
					createdAt: revision,
					approvedAt: null,
					approvedById: null,
					approvedSessionId: null,
					appliedActivityIds: [],
				}),
			findUnique: async () =>
				state.proposal ? { ...state.proposal, request: state.request } : null,
			update: async ({ data }: { data: Partial<SalesProposal> }) => {
				if (!state.proposal) throw new Error("Missing proposal");
				return Object.assign(state.proposal, data);
			},
		},
		activity: {
			create: async ({
				data,
			}: {
				data: Prisma.ActivityUncheckedCreateInput;
			}) => {
				state.activities.push(data);
				return data;
			},
		},
	};
	const db = {
		...tx,
		$transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
			run(tx),
	} as unknown as Db;
	return { state, service: new SalesService(db) };
}

describe("sales boundary", () => {
	it("requires one explicit candidate and exact approved profile", () => {
		expect(salesRequestInput.safeParse(input).success).toBe(true);
		for (const change of [
			{ candidateIds: [] },
			{ candidateIds: ["a", "b"] },
			{ profileId: "other" },
			{ profileRevision: "other" },
			{ idempotencyKey: "client-key" },
		])
			expect(salesRequestInput.safeParse({ ...input, ...change }).success).toBe(
				false,
			);
	});
	it("rejects invented evidence, other contacts, arbitrary fields, duplicate types and too many operations", () => {
		expect(validateSalesOperations(source, "contact", operations)).toHaveLength(
			3,
		);
		for (const bad of [
			[{ ...operations[0], value: "invented" }],
			[{ ...operations[0], contactId: "other" }],
			[{ ...operations[0], field: "email" }],
			[{ ...operations[0], evidence: "invented", value: "invented" }],
			[operations[0], operations[0]],
			[...operations, operations[0]],
		])
			expect(() => validateSalesOperations(source, "contact", bad)).toThrow();
	});
	it("separates read and proposal-write and rejects API-key approval even with approval scope", () => {
		expect(() => requireSalesScope(reader, SALES_SCOPES.read)).not.toThrow();
		expect(() => requireSalesScope(reader, SALES_SCOPES.write)).toThrow();
		expect(() => requireSalesScope(writer, SALES_SCOPES.write)).not.toThrow();
		expect(() =>
			requireSalesScope(
				{ ...reader, scopes: [SALES_SCOPES.approve] },
				SALES_SCOPES.approve,
			),
		).toThrow();
	});
});

describe("sales persistence service", () => {
	for (const scopes of [[], [SALES_SCOPES.write], ["crm:write"]]) {
		for (const operation of [
			"createRequest",
			"getRequest",
			"pendingRequests",
			"failRequest",
			"storeProposal",
			"approveProposal",
		] as const) {
			it(`denies ${operation} response data before database access for ${JSON.stringify(scopes)}`, async () => {
				let accesses = 0;
				const db = new Proxy(
					{},
					{
						get() {
							accesses++;
							throw new Error("Database accessed before authorization");
						},
					},
				) as Db;
				const service = new SalesService(db);
				const key: SalesActor = {
					kind: "apiKey",
					userId: "worker",
					keyId: "key-worker",
					scopes,
				};
				let response: unknown;
				await expect(
					(async () => {
						response = await service[operation](
							key,
							operation === "getRequest" || operation === "failRequest"
								? "missing"
								: operation === "storeProposal"
									? ({
											requestId: "00000000-0000-4000-8000-000000000001",
											operations,
										} as never)
									: (input as never),
						);
					})(),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				expect(response).toBeUndefined();
				expect(accesses).toBe(0);
			});
		}
	}
	it("allows a reading writer to create the unchanged full request response", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(
			{ ...writer, scopes: [SALES_SCOPES.write, SALES_SCOPES.read] },
			input,
		);
		expect(request.contactSnapshot).toMatchObject({
			firstName: "Actual",
			title: "Old",
		});
		expect(state.request?.id).toBe(request.id);
	});
	it("denies write-only pending reads and failure response reads", async () => {
		const { service } = fixture();
		await expect(service.pendingRequests(writer)).rejects.toThrow("scope");
		await expect(service.failRequest(writer, "missing")).rejects.toThrow(
			"scope",
		);
	});
	it("queues a server-owned UUID and actual contact snapshot without applying operations", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(actor, input);
		expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(request.idempotencyKey).not.toBe(request.id);
		expect(request.contactSnapshot).toMatchObject({
			firstName: "Actual",
			title: "Old",
		});
		expect(request.status).toBe("PENDING");
		expect(state.activities).toHaveLength(0);
		expect(state.contact.title).toBe("Old");
	});
	it("rejects stale creation and read-only writes", async () => {
		const { service } = fixture();
		await expect(
			service.createRequest(actor, {
				...input,
				expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
			}),
		).rejects.toThrow("revision");
		await expect(service.createRequest(reader, input)).rejects.toThrow("scope");
		await expect(service.storeProposal(reader, {})).rejects.toThrow("scope");
	});
	it("stores a proposal once without writes and rejects replacement", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(actor, input);
		const proposal = await service.storeProposal(readingWriter, {
			requestId: request.id,
			operations,
			producedBy: "synthetic",
		});
		const replay = await service.storeProposal(readingWriter, {
			requestId: request.id,
			operations,
			producedBy: "synthetic",
		});
		expect(replay.id).toBe(proposal.id);
		expect(state.contact.title).toBe("Old");
		expect(state.activities).toHaveLength(0);
		await expect(
			service.storeProposal(readingWriter, {
				requestId: request.id,
				operations: [operations[0]],
				producedBy: "synthetic",
			}),
		).rejects.toThrow("exists");
	});
	it("applies title and real NOTE/TASK once and preserves the original audit on replay", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(actor, input);
		const proposal = await service.storeProposal(readingWriter, {
			requestId: request.id,
			operations,
			producedBy: "synthetic",
		});
		const approval = {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
		};
		const applied = await service.approveProposal(actor, approval);
		await service.approveProposal(
			{ ...actor, userId: "second-human" },
			approval,
		);
		expect(state.contact.title).toBe("Sales Director");
		expect(state.activities.map((a) => a.type)).toEqual(["TASK", "NOTE"]);
		expect(state.activities.every((a) => a.companyId === "company")).toBe(true);
		expect(state.company.lastActivityAt).toEqual(state.contact.updatedAt);
		expect(applied.approvedById).toBe("human");
		expect(applied.approvedSessionId).toBe("session");
		expect(applied.appliedActivityIds).toHaveLength(2);
		expect(state.request?.status).toBe("APPROVED");
		expect(
			state.locks.some(
				(sql) => sql.includes('"contact"') && sql.includes("FOR UPDATE"),
			),
		).toBe(true);
	});
	it("rejects changed contact revisions before writing", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(actor, input);
		const proposal = await service.storeProposal(readingWriter, {
			requestId: request.id,
			operations,
			producedBy: "synthetic",
		});
		state.contact.updatedAt = new Date("2026-09-23T00:00:00.000Z");
		await expect(
			service.approveProposal(actor, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
			}),
		).rejects.toThrow("revision");
		expect(state.activities).toHaveLength(0);
		expect(state.proposal?.approvedAt).toBeNull();
	});
	it("requires a live session and the server approval key", async () => {
		const { service, state } = fixture();
		const request = await service.createRequest(actor, input);
		const proposal = await service.storeProposal(readingWriter, {
			requestId: request.id,
			operations,
			producedBy: "synthetic",
		});
		await expect(
			service.approveProposal(writer, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
			}),
		).rejects.toThrow("Human");
		await expect(
			service.approveProposal(actor, {
				proposalId: proposal.id,
				idempotencyKey: request.id,
			}),
		).rejects.toThrow("key mismatch");
		state.session = false;
		await expect(
			service.approveProposal(actor, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
			}),
		).rejects.toThrow("session");
		expect(state.activities).toHaveLength(0);
	});
});
