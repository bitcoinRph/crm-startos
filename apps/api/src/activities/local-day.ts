const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function dateFormatter(timeZone: string) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		calendar: "iso8601",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}

function formatDate(instant: Date, formatter: Intl.DateTimeFormat): string {
	const parts = formatter.formatToParts(instant);
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${value("year").padStart(4, "0")}-${value("month")}-${value("day")}`;
}

export function localDateAt(instant: Date, timeZone: string): string {
	return formatDate(instant, dateFormatter(timeZone));
}

export function addLocalDays(date: string, days: number): string {
	const instant = new Date(`${date}T00:00:00Z`);
	instant.setUTCDate(instant.getUTCDate() + days);
	return instant.toISOString().slice(0, 10);
}

export function localDayStart(date: string, timeZone: string): Date {
	const formatter = dateFormatter(timeZone);
	const nominal = new Date(`${date}T00:00:00Z`).getTime();
	let low = nominal - 2 * DAY_MS;
	let high = nominal + 2 * DAY_MS;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (formatDate(new Date(middle), formatter) < date) low = middle + 1;
		else high = middle;
	}
	return new Date(low);
}
