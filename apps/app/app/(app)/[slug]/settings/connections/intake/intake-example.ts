const INTAKE_PATH = "/api/trpc/intake.submit";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

const EXAMPLE_BODY = JSON.stringify({
	email: "dana@example.com",
	firstName: "Dana",
	message: "Can I get a demo?",
	source: "website-form",
});

function first(value: string | null): string | null {
	return value?.split(",")[0]?.trim() || null;
}

export function intakeOrigin(headers: Headers, fallback: string): string {
	const host = first(headers.get("x-forwarded-host")) ?? headers.get("host");
	if (!host) return fallback;
	const protocol =
		first(headers.get("x-forwarded-proto")) ??
		(LOCAL_HOST.test(host) ? "http" : "https");
	return `${protocol}://${host}`;
}

export function intakeEndpoint(origin: string): string {
	return `${origin}${INTAKE_PATH}`;
}

export function intakeCurl(origin: string): string {
	return [
		`curl -X POST ${intakeEndpoint(origin)} \\`,
		`  -H "Authorization: Bearer crm_..." \\`,
		`  -H "Content-Type: application/json" \\`,
		`  -d '${EXAMPLE_BODY}'`,
	].join("\n");
}
