import { z } from "zod";
import { CSV_ENTITIES } from "./csv-columns";
import { CSV } from "./csv-config";

const csvEntity = z.enum(CSV_ENTITIES);

export const csvExportInput = z.object({ entity: csvEntity });

export const csvExportOutput = z.object({
	entity: csvEntity,
	filename: z.string(),
	csv: z.string(),
	rows: z.number(),
	truncated: z.boolean(),
});

const rowNote = z.object({ row: z.number(), message: z.string() });

export const csvImportInput = z.object({
	entity: csvEntity,
	csv: z
		.string()
		.min(1, "The file is empty.")
		.refine(
			(text) => Buffer.byteLength(text, "utf8") <= CSV.import.maxBytes,
			`The file is larger than ${CSV.import.maxBytes / (1024 * 1024)} MiB. Split it and import the parts.`,
		),
	dryRun: z.boolean(),
	mapping: z.record(z.string(), z.string()).optional(),
});

export type CsvImportInput = z.infer<typeof csvImportInput>;

export const csvImportOutput = z.object({
	dryRun: z.boolean(),
	create: z.number(),
	update: z.number(),
	skip: z.number(),
	errors: z.array(rowNote),
	skipped: z.array(rowNote),
	ignoredColumns: z.array(z.string()),
});
