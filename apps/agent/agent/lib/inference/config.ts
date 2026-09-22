const SECOND_MS = 1000;

export const LOCAL_INFERENCE = {
	profile: "ollama-0.34.0-no-thinking-verified-context-v2",
	contextWindowTokens: 4096,
	maxOutputTokens: 1024,
	requestTimeoutMs: 120 * SECOND_MS,
	runner: {
		verifiedVersions: ["0.34.0"],
	},
} as const;

export function isVerifiedRunnerVersion(version: string): boolean {
	return LOCAL_INFERENCE.runner.verifiedVersions.some(
		(verified) => verified === version,
	);
}

export function unverifiedRunnerVersion(version: string): string {
	return `Ollama ${version} is not a verified version. Verified: ${LOCAL_INFERENCE.runner.verifiedVersions.join(", ")}.`;
}
