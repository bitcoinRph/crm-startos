CREATE TYPE "ApiKeyCallOutcome" AS ENUM ('allowed', 'denied');

CREATE TABLE "apiKeyCall" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" "ApiKeyCallOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apiKeyCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "apiKeyCall_keyId_createdAt_idx" ON "apiKeyCall"("keyId", "createdAt");

CREATE INDEX "apiKeyCall_createdAt_idx" ON "apiKeyCall"("createdAt");

ALTER TABLE "apiKeyCall" ADD CONSTRAINT "apiKeyCall_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "apikey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
