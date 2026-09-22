ALTER TABLE "salesRequest" DROP CONSTRAINT "salesRequest_profileId_check";
ALTER TABLE "salesRequest" DROP CONSTRAINT "salesRequest_profileRevision_check";
ALTER TABLE "salesRequest" ADD COLUMN "requestedByKeyId" TEXT;
ALTER TABLE "salesProposal" ADD COLUMN "proposedById" TEXT;
ALTER TABLE "salesProposal" ADD COLUMN "proposedByKeyId" TEXT;
ALTER TABLE "salesProposal" ADD COLUMN "producedBy" TEXT;
