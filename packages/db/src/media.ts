import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { MEDIA_NAME, MEDIA_PATH_PREFIX, MEDIA_TYPES } from "./images";

export function mediaDir(): string | null {
	const dir = process.env.CRM_MEDIA_DIR?.trim();
	return dir && isAbsolute(dir) ? dir : null;
}

export function mediaName(
	prefix: string,
	digest: string,
	extension: string,
): string {
	const stem =
		prefix
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "media";

	return `${stem}-${digest}.${extension}`;
}

export function mediaPath(name: string): string {
	return `${MEDIA_PATH_PREFIX}${name}`;
}

export async function writeMedia(
	dir: string,
	name: string,
	bytes: Buffer,
): Promise<void> {
	await mkdir(dir, { recursive: true });

	const target = join(dir, name);
	const temporary = `${target}.${randomUUID()}.tmp`;

	try {
		await writeFile(temporary, bytes);
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

export async function readMedia(
	dir: string,
	name: string,
): Promise<{ bytes: Buffer; type: string } | null> {
	if (!MEDIA_NAME.test(name)) return null;

	const root = resolve(dir);
	const path = resolve(root, name);
	if (dirname(path) !== root) return null;

	const type = MEDIA_TYPES.get(name.slice(name.lastIndexOf(".") + 1));
	if (!type) return null;

	try {
		return { bytes: await readFile(path), type };
	} catch {
		return null;
	}
}
