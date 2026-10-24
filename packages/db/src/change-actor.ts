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

export type ChangeExpectation = {
	entity: "COMPANY" | "CONTACT" | "DEAL";
	recordId: string;
	fieldId: string | null;
	values: Record<string, string | number | boolean | null>;
};

declare global {
	var crmChangeActor: ChangeActorState | undefined;
	var crmChangeExpectation: AsyncLocalStorage<ChangeExpectation> | undefined;
}

const state: ChangeActorState = globalThis.crmChangeActor ?? {
	storage: new AsyncLocalStorage<ChangeActor>(),
	fallback: { kind: "SYSTEM" },
};
globalThis.crmChangeActor = state;

const expectation =
	globalThis.crmChangeExpectation ?? new AsyncLocalStorage<ChangeExpectation>();
globalThis.crmChangeExpectation = expectation;

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

export function runWithChangeExpectation<T>(
	expected: ChangeExpectation,
	run: () => PromiseLike<T>,
): Promise<T> {
	return expectation.run(expected, async () => await run());
}

export function changeExpectationTag(): string {
	const expected = expectation.getStore();
	return expected ? JSON.stringify(expected) : "";
}
