import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

const turbo = z
	.object({ globalPassThroughEnv: z.array(z.string()) })
	.loose()
	.parse(
		JSON.parse(
			readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"),
		),
	);

test("turbo passes the inference variables through its strict environment", () => {
	for (const key of [
		"CRM_INFERENCE_MODE",
		"CRM_LOCAL_INFERENCE_ALLOWED_HOSTS",
		"CRM_LOCAL_INFERENCE_JSON",
	])
		expect(turbo.globalPassThroughEnv).toContain(key);
});
