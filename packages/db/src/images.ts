export const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

export const MEDIA_PATH_PREFIX = "/media/";

const MEDIA_TYPE_BY_EXTENSION = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	avif: "image/avif",
	svg: "image/svg+xml",
	ico: "image/x-icon",
} as const;

export const MEDIA_TYPES = new Map<string, string>(
	Object.entries(MEDIA_TYPE_BY_EXTENSION),
);

export const MEDIA_NAME = new RegExp(
	`^[a-z0-9-]+-[0-9a-f]{12}\\.(${Object.keys(MEDIA_TYPE_BY_EXTENSION).join("|")})$`,
);

export const COMPANY_IMAGE_FIELDS = [
	"logoUrl",
	"logoDarkUrl",
	"iconUrl",
	"iconDarkUrl",
] as const;

export type CompanyImageField = (typeof COMPANY_IMAGE_FIELDS)[number];

const OPTIMIZABLE = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

export function isMediaPath(url: string): boolean {
	return (
		url.startsWith(MEDIA_PATH_PREFIX) &&
		MEDIA_NAME.test(url.slice(MEDIA_PATH_PREFIX.length))
	);
}

export function isMirrored(url: string | null | undefined): boolean {
	if (!url) return false;
	if (isMediaPath(url)) return true;
	try {
		return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
	} catch {
		return false;
	}
}

export function isOptimizable(url: string | null | undefined): boolean {
	if (!isMirrored(url) || !url) return false;

	try {
		const pathname = isMediaPath(url) ? url : new URL(url).pathname;
		const extension = pathname.split(".").pop()?.toLowerCase();
		return extension !== undefined && OPTIMIZABLE.has(extension);
	} catch {
		return false;
	}
}
