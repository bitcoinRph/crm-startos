import { describe, expect, it } from "bun:test";
import {
	addLocalDays,
	localDateAt,
	localDayStart,
} from "../src/activities/local-day";

const zones = [
	"America/New_York",
	"Europe/London",
	"Australia/Lord_Howe",
	"America/Santiago",
	"Asia/Kolkata",
	"Pacific/Chatham",
];

describe("local calendar boundaries", () => {
	for (const timeZone of zones) {
		it(`L1 finds the first instant of every 2026 date in ${timeZone}`, () => {
			for (
				let date = "2026-01-01";
				date < "2027-01-01";
				date = addLocalDays(date, 1)
			) {
				const start = localDayStart(date, timeZone);
				expect(localDateAt(start, timeZone)).toBe(date);
				expect(localDateAt(new Date(start.getTime() - 1), timeZone)).toBe(
					addLocalDays(date, -1),
				);
			}
		});
	}
	it("handles a midnight gap and a half-hour DST transition", () => {
		expect(localDayStart("2026-09-06", "America/Santiago").toISOString()).toBe(
			"2026-09-06T04:00:00.000Z",
		);
		expect(
			localDayStart("2026-10-05", "Australia/Lord_Howe").getTime() -
				localDayStart("2026-10-04", "Australia/Lord_Howe").getTime(),
		).toBe(23.5 * 60 * 60 * 1000);
	});
});
