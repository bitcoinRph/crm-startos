-- AlterEnum
ALTER TYPE "SalesRequestStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "salesProposal" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectedSessionId" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

ALTER TABLE "salesProposal" ADD CONSTRAINT "salesProposal_rejection_audit" CHECK (("rejectedAt" IS NULL AND "rejectedById" IS NULL AND "rejectedSessionId" IS NULL AND "rejectionReason" IS NULL) OR ("rejectedAt" IS NOT NULL AND "rejectedById" IS NOT NULL AND "rejectedSessionId" IS NOT NULL AND "rejectionReason" IS NOT NULL));

ALTER TABLE "salesProposal" ADD CONSTRAINT "salesProposal_single_decision" CHECK ("approvedAt" IS NULL OR "rejectedAt" IS NULL);

CREATE OR REPLACE FUNCTION sales_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'approvedAt' - 'approvedById' - 'approvedSessionId' - 'appliedActivityIds' - 'rejectedAt' - 'rejectedById' - 'rejectedSessionId' - 'rejectionReason') IS DISTINCT FROM (to_jsonb(OLD) - 'approvedAt' - 'approvedById' - 'approvedSessionId' - 'appliedActivityIds' - 'rejectedAt' - 'rejectedById' - 'rejectedSessionId' - 'rejectionReason') OR ((OLD."approvedAt" IS NOT NULL OR OLD."rejectedAt" IS NOT NULL) AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Sales proposal content and approval audit are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'error' - 'leasedUntil') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'error' - 'leasedUntil') THEN
    RAISE EXCEPTION 'Sales request content is immutable';
  END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Decided request is immutable';
  END IF;
  RETURN NEW;
END;
$$;
