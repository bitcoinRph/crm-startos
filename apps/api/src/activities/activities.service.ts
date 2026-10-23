import { ActivityType, type Db, type Prisma } from "@crm/db";
import { activityMeta } from "@crm/validation/activity-meta";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { blankToNull } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { readSnapshot } from "../database/read-snapshot";
import type {
	ActivityCreateInput,
	ActivityEntry,
	FollowUpCategory,
	FollowUpsCursor,
	FollowUpsInput,
	FollowUpsResult,
	MyTasksInput,
	TimelineCounts,
	TimelineFilter,
	TimelineInput,
	TimelineResult,
} from "./activities.contracts";
import { followUpsCursor } from "./activities.contracts";
import { addLocalDays, localDateAt, localDayStart } from "./local-day";

const AUTHOR_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const ENTRY_SELECT = {
	id: true,
	type: true,
	subject: true,
	body: true,
	occurredAt: true,
	dueAt: true,
	completedAt: true,
	meta: true,
	createdAt: true,
	createdBy: { select: AUTHOR_SELECT },
	company: { select: { id: true, name: true } },
	contact: { select: { id: true, firstName: true, lastName: true } },
	deal: { select: { id: true, name: true } },

	emailThread: {
		select: {
			id: true,
			messageCount: true,
			lastMessageAt: true,
		},
	},
	calendarEvent: {
		select: {
			id: true,
			startsAt: true,
			endsAt: true,
			isAllDay: true,
			location: true,
			conferenceUrl: true,
			_count: { select: { attendees: true } },
		},
	},
} as const;

const NOTE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
];

@Injectable()
export class ActivitiesService {
	private readonly logger = new Logger(ActivitiesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
	) {}

	async timeline(input: TimelineInput): Promise<TimelineResult> {
		const where = this.anchor(input);
		Object.assign(where, filterClause(input.filter));

		const rows = await this.db.activity.findMany({
			where,
			take: input.limit + 1,
			cursor: input.cursor ? { id: input.cursor } : undefined,
			skip: input.cursor ? 1 : undefined,
			orderBy: [
				{ occurredAt: { sort: "desc", nulls: "last" } },
				{ id: "desc" },
			],
			select: ENTRY_SELECT,
		});

		const hasMore = rows.length > input.limit;
		const entries = hasMore ? rows.slice(0, input.limit) : rows;

		return {
			entries: entries.map(serializeEntry),
			nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
		};
	}

	async timelineCounts(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	): Promise<TimelineCounts> {
		const anchor = this.anchor(input);

		const [all, notes, upcoming, done, email, meetings] = await Promise.all([
			this.db.activity.count({ where: anchor }),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("notes") },
			}),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("upcoming") },
			}),
			this.db.activity.count({ where: { ...anchor, ...filterClause("done") } }),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("email") },
			}),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("meetings") },
			}),
		]);

		return { all, notes, upcoming, done, email, meetings };
	}

	async create(
		input: ActivityCreateInput,
		actingUserId: string,
	): Promise<ActivityEntry> {
		const companyId = await this.resolveCompanyId(input);

		const isTask = input.type === ActivityType.TASK;

		const activity = await this.db.activity.create({
			data: {
				type: input.type,
				subject: blankToNull(input.subject ?? ""),
				body: blankToNull(input.body ?? ""),
				occurredAt: parseDate(input.occurredAt) ?? new Date(),
				dueAt: isTask ? parseDate(input.dueAt) : null,
				companyId,
				contactId: input.contactId ?? null,
				dealId: input.dealId ?? null,
				createdById: actingUserId,
			},
			select: ENTRY_SELECT,
		});

		await this.stamp.touch(
			{ companyId, contactId: input.contactId, dealId: input.dealId },
			activity.createdAt,
		);

		this.logger.log({
			message: "Activity logged",
			activityId: activity.id,
			type: activity.type,
		});

		return serializeEntry(activity);
	}

	async complete(id: string, completed: boolean): Promise<ActivityEntry> {
		const activity = await this.db.activity.findUnique({
			where: { id },
			select: { type: true },
		});

		if (!activity) {
			throw new NotFoundException(`No activity with id ${id}.`);
		}

		if (activity.type !== ActivityType.TASK) {
			throw new BadRequestException("Only tasks can be completed.");
		}

		const updated = await this.db.activity.update({
			where: { id },
			data: { completedAt: completed ? new Date() : null },
			select: ENTRY_SELECT,
		});

		return serializeEntry(updated);
	}

	async myTasks(
		input: MyTasksInput,
		actingUserId: string,
	): Promise<ActivityEntry[]> {
		const now = new Date();
		const where: Prisma.ActivityWhereInput = {
			type: ActivityType.TASK,
			completedAt: null,
			createdById: actingUserId,
		};

		if (input.window === "overdue") where.dueAt = { lt: now };
		if (input.window === "upcoming") where.dueAt = { gte: now };

		const tasks = await this.db.activity.findMany({
			where,
			take: input.limit,
			orderBy: [
				{ dueAt: { sort: "asc", nulls: "last" } },
				{ createdAt: "desc" },
			],
			select: ENTRY_SELECT,
		});

		return tasks.map(serializeEntry);
	}

	async followUps(
		input: FollowUpsInput,
		actingUserId: string,
	): Promise<FollowUpsResult> {
		const cursor = input.cursor ? decodeFollowUpsCursor(input.cursor) : null;
		const asOf = new Date(input.asOf ?? cursor?.asOf ?? new Date());
		const asOfIso = asOf.toISOString();
		if (
			cursor &&
			(cursor.asOf !== asOfIso ||
				cursor.timeZone !== input.timeZone ||
				cursor.days !== input.days ||
				cursor.createdById !== actingUserId)
		) {
			throw new BadRequestException(
				"The cursor does not match the follow-up parameters or caller.",
			);
		}
		const date = localDateAt(asOf, input.timeZone);
		const todayStart = localDayStart(date, input.timeZone);
		const tomorrowStart = localDayStart(addLocalDays(date, 1), input.timeZone);
		const windowEnd = localDayStart(
			addLocalDays(date, 1 + input.days),
			input.timeZone,
		);
		if (
			!(
				todayStart.getTime() <= asOf.getTime() &&
				asOf.getTime() < tomorrowStart.getTime() &&
				tomorrowStart.getTime() <= windowEnd.getTime()
			)
		) {
			throw new BadRequestException(
				"The time zone and asOf do not produce ordered local day boundaries.",
			);
		}
		const base: Prisma.ActivityWhereInput = {
			type: ActivityType.TASK,
			completedAt: null,
			createdById: actingUserId,
			AND: [
				{ OR: [{ companyId: null }, { company: { archivedAt: null } }] },
				{ OR: [{ contactId: null }, { contact: { archivedAt: null } }] },
				{ OR: [{ dealId: null }, { deal: { archivedAt: null } }] },
			],
		};
		const categories = {
			overdue: { dueAt: { lt: asOf } },
			due_today: { dueAt: { gte: asOf, lt: tomorrowStart } },
			next_days: { dueAt: { gte: tomorrowStart, lt: windowEnd } },
			later: { dueAt: { gte: windowEnd } },
			undated: { dueAt: null },
		} satisfies Record<FollowUpCategory, Prisma.ActivityWhereInput>;
		return readSnapshot(this.db, async (tx) => {
			const timestamp = z
				.array(z.object({ countedAt: z.date() }))
				.parse(
					await tx.$queryRaw`SELECT transaction_timestamp() AS "countedAt"`,
				);
			const countedAt = timestamp[0]?.countedAt.toISOString();
			if (!countedAt) throw new Error("The read snapshot has no timestamp.");
			const [rows, overdue, dueToday, nextDays, later, undated, total] =
				await Promise.all([
					tx.activity.findMany({
						where: { AND: [base, cursor ? afterFollowUpsCursor(cursor) : {}] },
						take: input.limit + 1,
						orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
						select: ENTRY_SELECT,
					}),
					tx.activity.count({ where: { AND: [base, categories.overdue] } }),
					tx.activity.count({ where: { AND: [base, categories.due_today] } }),
					tx.activity.count({ where: { AND: [base, categories.next_days] } }),
					tx.activity.count({ where: { AND: [base, categories.later] } }),
					tx.activity.count({ where: { AND: [base, categories.undated] } }),
					tx.activity.count({ where: base }),
				]);
			const page = rows.slice(0, input.limit);
			const last = page[page.length - 1];
			return {
				asOf: asOfIso,
				timeZone: input.timeZone,
				days: input.days,
				scope: "created_by_caller",
				boundaries: {
					todayStart: todayStart.toISOString(),
					tomorrowStart: tomorrowStart.toISOString(),
					windowEnd: windowEnd.toISOString(),
				},
				counts: {
					overdue,
					due_today: dueToday,
					next_days: nextDays,
					later,
					undated,
					total,
				},
				countedAt,
				items: page.map((row) => ({
					category: followUpCategoryOf(
						row.dueAt,
						asOf,
						tomorrowStart,
						windowEnd,
					),
					dueLocalDate: row.dueAt
						? localDateAt(row.dueAt, input.timeZone)
						: null,
					task: serializeEntry(row),
				})),
				nextCursor:
					rows.length > input.limit && last
						? Buffer.from(
								JSON.stringify({
									asOf: asOfIso,
									timeZone: input.timeZone,
									days: input.days,
									createdById: actingUserId,
									dueAt: last.dueAt?.toISOString() ?? null,
									id: last.id,
								} satisfies FollowUpsCursor),
							).toString("base64url")
						: null,
			};
		});
	}

	private anchor(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	): Prisma.ActivityWhereInput {
		if (input.dealId) return { dealId: input.dealId };
		if (input.contactId) return { contactId: input.contactId };
		if (input.companyId) return { companyId: input.companyId };
		throw new BadRequestException(
			"A timeline needs a company, a contact or a deal.",
		);
	}

	private async resolveCompanyId(
		input: ActivityCreateInput,
	): Promise<string | null> {
		if (input.companyId) return input.companyId;

		if (input.dealId) {
			const deal = await this.db.deal.findUnique({
				where: { id: input.dealId },
				select: { companyId: true },
			});
			if (!deal) {
				throw new NotFoundException(`No deal with id ${input.dealId}.`);
			}
			return deal.companyId;
		}

		if (input.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: input.contactId },
				select: { companyId: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${input.contactId}.`);
			}
			return contact.companyId;
		}

		return null;
	}
}

function filterClause(filter: TimelineFilter): Prisma.ActivityWhereInput {
	switch (filter) {
		case "notes":
			return { type: { in: NOTE_TYPES } };
		case "upcoming":
			return { type: ActivityType.TASK, completedAt: null };
		case "done":
			return { type: ActivityType.TASK, completedAt: { not: null } };
		case "history":
			return { NOT: { type: ActivityType.TASK, completedAt: null } };
		case "email":
			return { type: ActivityType.EMAIL };
		case "meetings":
			return { type: ActivityType.MEETING };
		case "all":
			return {};
	}
}

type Entry = Prisma.ActivityGetPayload<{ select: typeof ENTRY_SELECT }>;

function serializeEntry(entry: Entry) {
	return {
		...entry,
		occurredAt: entry.occurredAt?.toISOString() ?? null,
		dueAt: entry.dueAt?.toISOString() ?? null,
		completedAt: entry.completedAt?.toISOString() ?? null,
		createdAt: entry.createdAt.toISOString(),
		meta: activityMeta.parse(entry.meta),

		emailThread: entry.emailThread
			? {
					id: entry.emailThread.id,
					messageCount: entry.emailThread.messageCount,
					lastMessageAt: entry.emailThread.lastMessageAt.toISOString(),
				}
			: null,

		calendarEvent: entry.calendarEvent
			? {
					id: entry.calendarEvent.id,
					startsAt: entry.calendarEvent.startsAt.toISOString(),
					endsAt: entry.calendarEvent.endsAt.toISOString(),
					isAllDay: entry.calendarEvent.isAllDay,
					location: entry.calendarEvent.location,
					conferenceUrl: entry.calendarEvent.conferenceUrl,
					attendeeCount: entry.calendarEvent._count.attendees,
				}
			: null,
	};
}

function decodeFollowUpsCursor(encoded: string): FollowUpsCursor {
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(encoded))
			throw new Error("Invalid base64url.");
		const bytes = Buffer.from(encoded, "base64url");
		if (bytes.toString("base64url") !== encoded)
			throw new Error("Invalid base64url.");
		return followUpsCursor.parse(JSON.parse(bytes.toString("utf8")));
	} catch {
		throw new BadRequestException("Invalid follow-up cursor.");
	}
}

function afterFollowUpsCursor(
	cursor: FollowUpsCursor,
): Prisma.ActivityWhereInput {
	if (cursor.dueAt === null) return { dueAt: null, id: { gt: cursor.id } };
	const dueAt = new Date(cursor.dueAt);
	return {
		OR: [
			{ dueAt: { gt: dueAt } },
			{ dueAt, id: { gt: cursor.id } },
			{ dueAt: null },
		],
	};
}

function followUpCategoryOf(
	dueAt: Date | null,
	asOf: Date,
	tomorrowStart: Date,
	windowEnd: Date,
): FollowUpCategory {
	if (dueAt === null) return "undated";
	if (dueAt < asOf) return "overdue";
	if (dueAt < tomorrowStart) return "due_today";
	if (dueAt < windowEnd) return "next_days";
	return "later";
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
