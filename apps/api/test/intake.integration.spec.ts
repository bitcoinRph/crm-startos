import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db } from "@crm/db";
import { activityMetaFields } from "@crm/validation/activity-meta";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { IntakeService } from "../src/intake/intake.service";

const suffix = process.env.TEST_RUN_ID ?? "intake-spec";
const domain = `leads-${suffix}.test`;
const otherDomain = `partner-${suffix}.test`;

const agent = new AgentTriggerService(db);
const intake = new IntakeService(
	db,
	new CompanyDirectoryService(agent),
	agent,
	new ActivityStampService(db),
);

let userId: string;

async function contactsFor(email: string) {
	return db.contact.findMany({ where: { email } });
}

async function clean() {
	const contacts = await db.contact.findMany({
		where: { email: { endsWith: `-${suffix}.test` } },
		select: { id: true },
	});
	const ids = contacts.map((contact) => contact.id);
	await db.agentTask.deleteMany({ where: { contactId: { in: ids } } });
	const companies = await db.company.findMany({
		where: { domain: { in: [domain, otherDomain] } },
		select: { id: true },
	});
	await db.agentTask.deleteMany({
		where: { companyId: { in: companies.map((company) => company.id) } },
	});
	await db.activity.deleteMany({ where: { contactId: { in: ids } } });
	await db.contact.deleteMany({ where: { id: { in: ids } } });
	await db.company.deleteMany({
		where: { domain: { in: [domain, otherDomain] } },
	});
	await db.suppressedContact.deleteMany({
		where: { email: { endsWith: `-${suffix}.test` } },
	});
	await db.suppressedDomain.deleteMany({
		where: { domain: { endsWith: `-${suffix}.test` } },
	});
}

beforeAll(async () => {
	await clean();
	const user = await db.user.findFirst({ select: { id: true } });
	userId =
		user?.id ??
		(
			await db.user.create({
				data: {
					id: `user-${suffix}`,
					name: "Test Rep",
					email: `rep-${suffix}@example.test`,
				},
				select: { id: true },
			})
		).id;
});

beforeEach(clean);

afterAll(async () => {
	await clean();
	if (userId.startsWith(`user-${suffix}`)) {
		await db.user.deleteMany({ where: { id: userId } });
	}
});

describe("inbound intake", () => {
	it("creates the contact, one activity and an agent task", async () => {
		const email = `dana.reed@${domain}`;
		const result = await intake.submit(
			{
				email: email.toUpperCase(),
				firstName: "Dana",
				lastName: "Reed",
				message: "Can I get a demo?",
				source: "website-form",
			},
			userId,
		);

		expect(result.status).toBe("accepted");
		expect(result.created).toBe(true);

		const [contact] = await contactsFor(email);
		expect(contact?.id).toBe(result.contactId ?? "");
		expect(contact?.firstName).toBe("Dana");
		expect(contact?.lastName).toBe("Reed");
		expect(contact?.source).toBe("INTAKE");
		expect(contact?.companyId).toBeTruthy();
		expect(contact?.lastActivityAt).not.toBeNull();

		const activities = await db.activity.findMany({
			where: { contactId: contact?.id },
		});
		expect(activities).toHaveLength(1);
		expect(activities[0]?.type).toBe("NOTE");
		expect(activities[0]?.body).toBe("Can I get a demo?");
		expect(activities[0]?.createdById).toBe(userId);
		expect(activityMetaFields.parse(activities[0]?.meta)).toEqual({
			automated: true,
			source: "intake",
			label: "website-form",
			company: null,
		});

		const tasks = await db.agentTask.findMany({
			where: { contactId: contact?.id, kind: "identify" },
		});
		expect(tasks).toHaveLength(1);
	});

	it("reuses the contact on a second submit and adds an activity", async () => {
		const email = `repeat@${domain}`;
		const first = await intake.submit(
			{ email, message: "First question" },
			userId,
		);
		const second = await intake.submit(
			{ email: email.toUpperCase(), message: "Second question" },
			userId,
		);

		expect(second.status).toBe("accepted");
		expect(second.created).toBe(false);
		expect(second.contactId).toBe(first.contactId);
		expect(await contactsFor(email)).toHaveLength(1);

		const activities = await db.activity.findMany({
			where: { contactId: first.contactId ?? "" },
			orderBy: { createdAt: "asc" },
		});
		expect(activities.map((activity) => activity.body)).toEqual([
			"First question",
			"Second question",
		]);
		expect(
			await db.agentTask.count({
				where: { contactId: first.contactId ?? "", kind: "identify" },
			}),
		).toBe(1);
	});

	it("links a company by the domain given and creates it once", async () => {
		const first = await intake.submit(
			{
				email: `a@${domain}`,
				companyDomain: `https://www.${otherDomain}/pricing`,
			},
			userId,
		);
		const second = await intake.submit(
			{ email: `b@${domain}`, companyDomain: otherDomain },
			userId,
		);

		const companies = await db.company.findMany({
			where: { domain: otherDomain },
		});
		expect(companies).toHaveLength(1);
		const linked = await db.contact.findMany({
			where: { id: { in: [first.contactId ?? "", second.contactId ?? ""] } },
		});
		expect(linked).toHaveLength(2);
		for (const contact of linked) {
			expect(contact.companyId).toBe(companies[0]?.id ?? "");
		}
	});

	it("names a contact from the address when no name is given", async () => {
		const result = await intake.submit({ email: `sam.lee@${domain}` }, userId);
		const contact = await db.contact.findUnique({
			where: { id: result.contactId ?? "" },
		});
		expect(contact?.firstName).toBe("Sam");
		expect(contact?.lastName).toBe("Lee");
	});

	it("creates nothing for an address a rep deleted", async () => {
		const email = `gone@${domain}`;
		await db.suppressedContact.create({ data: { email } });
		const tasksBefore = await db.agentTask.count();

		const result = await intake.submit(
			{ email: email.toUpperCase(), message: "Hello again" },
			userId,
		);

		expect(result).toEqual({
			status: "suppressed",
			contactId: null,
			created: false,
		});
		expect(await contactsFor(email)).toHaveLength(0);
		expect(await db.activity.count({ where: { body: "Hello again" } })).toBe(0);
		expect(await db.agentTask.count()).toBe(tasksBefore);
	});

	it("creates nothing for a suppressed domain", async () => {
		await db.suppressedDomain.create({ data: { domain } });

		const result = await intake.submit({ email: `anyone@${domain}` }, userId);

		expect(result.status).toBe("suppressed");
		expect(await contactsFor(`anyone@${domain}`)).toHaveLength(0);
	});
});
