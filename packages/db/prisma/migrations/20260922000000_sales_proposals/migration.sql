CREATE TYPE "SalesRequestStatus" AS ENUM ('PENDING', 'PROPOSED', 'APPROVED', 'FAILED');
CREATE TABLE "salesRequest" (
  "id" UUID PRIMARY KEY,
  "idempotencyKey" UUID NOT NULL UNIQUE,
  "source" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "contactSnapshot" JSONB NOT NULL,
  "expectedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "profileId" TEXT NOT NULL CHECK ("profileId" = 'qwen-local-experimental'),
  "profileRevision" TEXT NOT NULL CHECK ("profileRevision" = 'sales-qwen-v1'),
  "requestedById" TEXT NOT NULL,
  "status" "SalesRequestStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "salesRequest_status_createdAt_idx" ON "salesRequest" ("status", "createdAt");
CREATE TABLE "salesProposal" (
  "id" UUID PRIMARY KEY,
  "requestId" UUID NOT NULL UNIQUE REFERENCES "salesRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotencyKey" UUID NOT NULL UNIQUE,
  "operations" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedSessionId" TEXT,
  "appliedActivityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "salesProposal_approval_audit" CHECK (("approvedAt" IS NULL AND "approvedById" IS NULL AND "approvedSessionId" IS NULL) OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "approvedSessionId" IS NOT NULL))
);
CREATE FUNCTION sales_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'error') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'error') THEN
    RAISE EXCEPTION 'Sales request content is immutable';
  END IF;
  IF OLD.status = 'APPROVED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Approved request is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_request_immutable BEFORE UPDATE ON "salesRequest" FOR EACH ROW EXECUTE FUNCTION sales_request_immutable();
CREATE FUNCTION sales_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'approvedAt' - 'approvedById' - 'approvedSessionId' - 'appliedActivityIds') IS DISTINCT FROM (to_jsonb(OLD) - 'approvedAt' - 'approvedById' - 'approvedSessionId' - 'appliedActivityIds') OR (OLD."approvedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Sales proposal content and approval audit are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_proposal_immutable BEFORE UPDATE ON "salesProposal" FOR EACH ROW EXECUTE FUNCTION sales_proposal_immutable();
