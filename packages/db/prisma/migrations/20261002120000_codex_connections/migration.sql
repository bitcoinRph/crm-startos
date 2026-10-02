CREATE TYPE "CodexCredentialKind" AS ENUM ('CHATGPT', 'API_KEY');

CREATE TYPE "CodexConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

ALTER TABLE "salesRequest" ADD COLUMN "leasedUntil" TIMESTAMP(3);

CREATE TABLE "codexConnection" (
    "userId" TEXT NOT NULL,
    "kind" "CodexCredentialKind" NOT NULL,
    "status" "CodexConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "sealed" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "planType" TEXT,
    "modelId" TEXT,
    "modelContextWindowTokens" INTEGER,
    "accessExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codexConnection_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "codexDeviceLogin" (
    "userId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codexDeviceLogin_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "codexConnection" ADD CONSTRAINT "codexConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "codexDeviceLogin" ADD CONSTRAINT "codexDeviceLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sales_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'error' - 'leasedUntil') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'error' - 'leasedUntil') THEN
    RAISE EXCEPTION 'Sales request content is immutable';
  END IF;
  IF OLD.status = 'APPROVED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Approved request is immutable';
  END IF;
  RETURN NEW;
END;
$$;
