import { AsyncLocalStorage } from "node:async_hooks";

export type ChangeActor =
	| { kind: "USER"; id: string }
	| { kind: "API_KEY"; id: string; userId: string }
	| { kind: "AGENT" }
	| { kind: "SYSTEM" };

const storage = new AsyncLocalStorage<ChangeActor>();
let fallback: ChangeActor = { kind: "SYSTEM" };

export function runAsChangeActor<T>(
	actor: ChangeActor,
	run: () => PromiseLike<T>,
): Promise<T> {
	return storage.run(actor, async () => await run());
}

export function setDefaultChangeActor(actor: ChangeActor): void {
	fallback = actor;
}

export function changeActorTag(): string {
	const actor = storage.getStore() ?? fallback;
	if (actor.kind === "USER") return `USER:${actor.id}`;
	if (actor.kind === "API_KEY") return `API_KEY:${actor.id}:${actor.userId}`;
	return actor.kind;
}
