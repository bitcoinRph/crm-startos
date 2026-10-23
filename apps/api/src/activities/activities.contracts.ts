import { ActivityType } from "@crm/db";
import { activityMeta } from "@crm/validation/activity-meta";
import { z } from "zod";
import { ACTIVITIES } from "./activities-config";

const COMPOSABLE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
	ActivityType.TASK,
] as const;

const composableEnum = z.enum(COMPOSABLE_TYPES);

const ALL_ACTIVITY_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
	ActivityType.TASK,
	ActivityType.STAGE_CHANGE,
	ActivityType.ENRICHMENT,
] as const;

const activityTypeOutput = z.enum(ALL_ACTIVITY_TYPES);

const TIMELINE_FILTERS = [
	"all",
	"history",
	"notes",
	"upcoming",
	"done",
	"email",
	"meetings",
] as const;

export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const timelineInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
	filter: z.enum(TIMELINE_FILTERS).default("all"),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(30),
});

export type TimelineInput = z.infer<typeof timelineInput>;

export const timelineCountsInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
});

export const activityCreateInput = z
	.object({
		type: composableEnum,
		subject: z.string().trim().optional(),
		body: z.string().trim().optional(),
		occurredAt: z.string().optional(),
		dueAt: z.string().nullable().optional(),
		companyId: z.string().optional(),
		contactId: z.string().optional(),
		dealId: z.string().optional(),
	})
	.refine((input) => input.companyId || input.contactId || input.dealId, {
		message: "An activity has to be about a company, a contact or a deal.",
	})
	.refine(
		(input) => input.type !== ActivityType.TASK || Boolean(input.subject),
		{
			message: "A task needs a subject — it is the thing to do.",
			path: ["subject"],
		},
	);

export type ActivityCreateInput = z.infer<typeof activityCreateInput>;

export const completeInput = z.object({
	id: z.string(),
	completed: z.boolean().default(true),
});

export const myTasksInput = z.object({
	window: z.enum(["overdue", "upcoming", "all"]).default("all"),
	limit: z.number().int().min(1).max(100).default(25),
});

export type MyTasksInput = z.infer<typeof myTasksInput>;

const activityAuthorOutput = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string().nullable(),
});

const activityCompanyRefOutput = z
	.object({
		id: z.string(),
		name: z.string(),
	})
	.nullable();

const activityContactRefOutput = z
	.object({
		id: z.string(),
		firstName: z.string(),
		lastName: z.string().nullable(),
	})
	.nullable();

const activityDealRefOutput = z
	.object({
		id: z.string(),
		name: z.string(),
	})
	.nullable();

const activityEmailThreadOutput = z
	.object({
		id: z.string(),
		messageCount: z.number(),
		lastMessageAt: z.string(),
	})
	.nullable();

const activityCalendarEventOutput = z
	.object({
		id: z.string(),
		startsAt: z.string(),
		endsAt: z.string(),
		isAllDay: z.boolean(),
		location: z.string().nullable(),
		conferenceUrl: z.string().nullable(),
		attendeeCount: z.number(),
	})
	.nullable();

export const activityEntryOutput = z.object({
	id: z.string(),
	type: activityTypeOutput,
	subject: z.string().nullable(),
	body: z.string().nullable(),
	occurredAt: z.string().nullable(),
	dueAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	meta: activityMeta,
	createdAt: z.string(),
	createdBy: activityAuthorOutput,
	company: activityCompanyRefOutput,
	contact: activityContactRefOutput,
	deal: activityDealRefOutput,
	emailThread: activityEmailThreadOutput,
	calendarEvent: activityCalendarEventOutput,
});

export type ActivityEntry = z.infer<typeof activityEntryOutput>;

export const timelineOutput = z.object({
	entries: z.array(activityEntryOutput),
	nextCursor: z.string().nullable(),
});

export type TimelineResult = z.infer<typeof timelineOutput>;

export const timelineCountsOutput = z.object({
	all: z.number(),
	notes: z.number(),
	upcoming: z.number(),
	done: z.number(),
	email: z.number(),
	meetings: z.number(),
});

export type TimelineCounts = z.infer<typeof timelineCountsOutput>;

export const myTasksOutput = z.array(activityEntryOutput);

export const activityCreateOutput = activityEntryOutput;

export const completeOutput = activityEntryOutput;

const timeZoneInput = z
	.string()
	.min(1)
	.max(ACTIVITIES.followUps.maxTimeZoneLength)
	.refine(
		(timeZone) => {
			if (
				timeZone.length > ACTIVITIES.followUps.maxTimeZoneLength ||
				/^[+-]/.test(timeZone)
			)
				return false;
			try {
				new Intl.DateTimeFormat("en", { timeZone });
				return true;
			} catch {
				return false;
			}
		},
		{ message: "timeZone must be an IANA time zone name." },
	);

const asOfInput = z.iso
	.datetime({ offset: true })
	.max(ACTIVITIES.followUps.maxAsOfLength)
	.refine(
		(value) =>
			value.length <= ACTIVITIES.followUps.maxAsOfLength &&
			Date.parse(value) >= Date.parse(ACTIVITIES.followUps.asOfMin) &&
			Date.parse(value) < Date.parse(ACTIVITIES.followUps.asOfMaxExclusive),
		{ message: "asOf must be within UTC years 0002 through 9998." },
	);

export const followUpsInput = z.strictObject({
	timeZone: timeZoneInput,
	days: z.number().int().min(1).max(ACTIVITIES.followUps.maxDays),
	asOf: asOfInput.optional(),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ACTIVITIES.followUps.maxLimit)
		.default(ACTIVITIES.followUps.defaultLimit),
	cursor: z
		.string()
		.min(1)
		.max(ACTIVITIES.followUps.maxCursorLength)
		.optional(),
});

export type FollowUpsInput = z.infer<typeof followUpsInput>;

export const followUpsCursor = z.strictObject({
	asOf: asOfInput,
	timeZone: timeZoneInput,
	days: z.number().int().min(1).max(ACTIVITIES.followUps.maxDays),
	createdById: z.string().min(1),
	dueAt: z.iso.datetime().nullable(),
	id: z.string().min(1),
});

export type FollowUpsCursor = z.infer<typeof followUpsCursor>;

const followUpCategory = z.enum([
	"overdue",
	"due_today",
	"next_days",
	"later",
	"undated",
]);
export type FollowUpCategory = z.infer<typeof followUpCategory>;

export const followUpsOutput = z.object({
	asOf: z.string(),
	timeZone: z.string(),
	days: z.number(),
	scope: z.literal("created_by_caller"),
	boundaries: z.object({
		todayStart: z.string(),
		tomorrowStart: z.string(),
		windowEnd: z.string(),
	}),
	counts: z.object({
		overdue: z.number(),
		due_today: z.number(),
		next_days: z.number(),
		later: z.number(),
		undated: z.number(),
		total: z.number(),
	}),
	countedAt: z.string(),
	items: z.array(
		z.object({
			category: followUpCategory,
			dueLocalDate: z.string().nullable(),
			task: activityEntryOutput,
		}),
	),
	nextCursor: z.string().nullable(),
});

export type FollowUpsResult = z.infer<typeof followUpsOutput>;
