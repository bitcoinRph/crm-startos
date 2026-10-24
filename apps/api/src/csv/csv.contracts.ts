import { z } from "zod";
import { CSV_ENTITIES } from "./csv-columns";

export const csvEntity = z.enum(CSV_ENTITIES);

export const csvExportInput = z.object({ entity: csvEntity });

export const csvExportOutput = z.object({
	entity: csvEntity,
	filename: z.string(),
	csv: z.string(),
	rows: z.number(),
	truncated: z.boolean(),
});
