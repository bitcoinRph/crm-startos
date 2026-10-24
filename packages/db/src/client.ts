import "@crm/env/load";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient, type QueryConfig } from "pg";
import { changeActorTag } from "./change-actor";
import { type Prisma, PrismaClient } from "./generated/prisma/client";

const connectionString =
	process.env.NODE_ENV === "test" ? testDatabase() : liveDatabase();

function liveDatabase(): string {
	const url = process.env.DATABASE_URL;

	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. Copy .env.example to .env at the root of the repo and fill it in, or set DATABASE_URL in the environment.",
		);
	}

	return url;
}

function testDatabase(): string {
	const url = process.env.TEST_DATABASE_URL;

	if (!url) {
		throw new Error(
			[
				"TEST_DATABASE_URL is not set, and the suite will not fall back to DATABASE_URL.",
				"",
				"These are real integration tests. They delete every workspace member and the",
				"organization row and put them back when the run finishes — so a run that is",
				"interrupted leaves everybody locked out of whatever database it was pointed at.",
				"The pre-push hook runs them, so that is one `git push` away from a database you",
				"care about.",
				"",
				"Make a throwaway one and point TEST_DATABASE_URL at it:",
				"",
				"    bun run db:test",
				"",
			].join("\n"),
		);
	}

	if (!databaseName(url).endsWith("_test")) {
		throw new Error(
			`TEST_DATABASE_URL must name a database ending in _test, so it cannot be one somebody is using. It names "${databaseName(url)}".`,
		);
	}

	return url;
}

function databaseName(url: string): string {
	try {
		return new URL(url).pathname.replace(/^\//, "");
	} catch {
		return url;
	}
}

export interface PrismaLogRecord {
	level: Prisma.LogLevel;
	message: string;
	target: string;
	durationMs?: number;
}

export type PrismaLogSink = (record: PrismaLogRecord) => void;

const consoleSink: PrismaLogSink = ({ level, message, target, durationMs }) => {
	const suffix = durationMs === undefined ? "" : ` (+${durationMs}ms)`;
	const line = `[prisma:${level}] ${message}${suffix} [${target}]`;

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}
};

let sink: PrismaLogSink = consoleSink;

export function setPrismaLogSink(next: PrismaLogSink | null): void {
	sink = next ?? consoleSink;
}

const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

const logDefinitions: Prisma.LogDefinition[] = [
	{ level: "warn", emit: "event" },
	{ level: "error", emit: "event" },
	...(logQueries
		? ([
				{ level: "query", emit: "event" },
				{ level: "info", emit: "event" },
			] satisfies Prisma.LogDefinition[])
		: []),
];

const SET_CHANGE_ACTOR = "SELECT set_config('crm.actor', $1, false)";
const WRITE_STATEMENT = /^\s*(insert|update|delete|with)\b/i;

function changeActorPool(url: string): Pool {
	const pool = new Pool({ connectionString: url });

	const connectAsActor = async (): Promise<PoolClient> => {
		const client = await pool.connect();
		try {
			await client.query(SET_CHANGE_ACTOR, [changeActorTag()]);
		} catch (error) {
			client.release(true);
			throw error;
		}
		return client;
	};

	const queryAsActor = async (config: QueryConfig) => {
		if (!WRITE_STATEMENT.test(config.text)) return pool.query(config);
		const client = await connectAsActor();
		try {
			return await client.query(config);
		} finally {
			client.release();
		}
	};

	return new Proxy(pool, {
		get(target, property, receiver) {
			if (property === "connect") return connectAsActor;
			if (property === "query") return queryAsActor;
			return Reflect.get(target, property, receiver);
		},
	});
}

const createPrismaClient = () => {
	const client = new PrismaClient({
		adapter: new PrismaPg(changeActorPool(connectionString), {
			disposeExternalPool: true,
		}),
		log: logDefinitions,
	});

	client.$on("error", ({ message, target }) => {
		sink({ level: "error", message, target });
	});
	client.$on("warn", ({ message, target }) => {
		sink({ level: "warn", message, target });
	});
	client.$on("info", ({ message, target }) => {
		sink({ level: "info", message, target });
	});
	client.$on("query", ({ query, duration, target }) => {
		sink({ level: "query", message: query, target, durationMs: duration });
	});

	return client;
};

declare global {
	var prisma: ReturnType<typeof createPrismaClient> | undefined;
}

export const db = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalThis.prisma = db;
}

export type Db = typeof db;
