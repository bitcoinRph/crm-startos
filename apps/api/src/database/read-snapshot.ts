import { type Db, Prisma } from "@crm/db";

export function readSnapshot<T>(
	db: Db,
	read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return db.$transaction(
		async (tx) => {
			await tx.$executeRaw`SET TRANSACTION READ ONLY`;
			return read(tx);
		},
		{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
	);
}
