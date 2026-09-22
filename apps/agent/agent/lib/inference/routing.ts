import {
	createLocalInference,
	type LocalConfig,
	selectionIdentity,
	unavailableModel,
} from "./local";

export function createLocalRouting(
	state: { get(): string | null; set(value: string | null): void },
	read: () => LocalConfig | null,
	approvedVersion: (identity: string) => Promise<boolean>,
	admitRoot: () => boolean = () => false,
) {
	const denied = createLocalInference(null);
	return {
		fallback: unavailableModel(),
		start: async () => {
			try {
				if (!admitRoot() || state.get() !== null) return null;
				const config = read();
				state.set(config ? selectionIdentity(config) : null);
			} catch {
				return null;
			}
			return null;
		},
		step: async () => {
			try {
				const config = read();
				if (!admitRoot() || !config) return denied;
				const identity = selectionIdentity(config);
				if (state.get() !== identity || !(await approvedVersion(identity)))
					return denied;
				return createLocalInference(config, fetch, () => {
					const current = read();
					if (
						!admitRoot() ||
						!current ||
						state.get() !== identity ||
						selectionIdentity(current) !== identity
					) {
						throw new Error(
							"LOCAL_INFERENCE_ROUTE_CHANGED: Start a new conversation after configuration changes.",
						);
					}
				});
			} catch {
				return denied;
			}
		},
	};
}
