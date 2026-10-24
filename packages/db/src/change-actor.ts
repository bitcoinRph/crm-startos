import { AsyncLocalStorage } from "node:async_hooks";

export type ChangeActor =
	| { kind: "USER"; id: string }
	| { kind: "API_KEY"; id: string; userId: string }
	| { kind: "AGENT" }
	| { kind: "SYSTEM" };

type ChangeActorState = {
	storage: AsyncLocalStorage<ChangeActor>;
	fallback: ChangeActor;
};

declare global {
	var crmChangeActor: ChangeActorState | undefined;
}

const state: ChangeActorState = globalThis.crmChangeActor ?? {
	storage: new AsyncLocalStorage<ChangeActor>(),
	fallback: { kind: "SYSTEM" },
};
globalThis.crmChangeActor = state;

export function runAsChangeActor<T>(
	actor: ChangeActor,
	run: () => PromiseLike<T>,
): Promise<T> {
	return state.storage.run(actor, async () => await run());
}

export function setDefaultChangeActor(actor: ChangeActor): void {
	state.fallback = actor;
}

export function changeActorTag(): string {
	const actor = state.storage.getStore() ?? state.fallback;
	if (actor.kind === "USER") return `USER:${actor.id}`;
	if (actor.kind === "API_KEY") return `API_KEY:${actor.id}:${actor.userId}`;
	return actor.kind;
}
