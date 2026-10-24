-- CreateEnum
CREATE TYPE "RecordChangeOperation" AS ENUM ('CREATE', 'UPDATE');

-- CreateEnum
CREATE TYPE "ChangeActorKind" AS ENUM ('USER', 'API_KEY', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "recordChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity" "FieldEntity" NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT,
    "operation" "RecordChangeOperation" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorKind" "ChangeActorKind" NOT NULL,
    "actorId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recordChange_entity_recordId_createdAt_idx" ON "recordChange"("entity", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "recordChange_actorKind_actorId_createdAt_idx" ON "recordChange"("actorKind", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "recordChange_createdAt_idx" ON "recordChange"("createdAt");


CREATE OR REPLACE FUNCTION crm_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor text := nullif(current_setting('crm.actor', true), '');
  actor_kind "ChangeActorKind" := 'SYSTEM';
  actor_id text;
  actor_user_id text;
  source jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  old_row jsonb := '{}'::jsonb;
  new_row jsonb := '{}'::jsonb;
  record_entity "FieldEntity";
  record_id text;
  field_id text;
  change_operation "RecordChangeOperation" := 'UPDATE';
  change_before jsonb;
  change_after jsonb;
BEGIN
  IF TG_TABLE_NAME = 'fieldValue' THEN
    record_id := coalesce(source->>'contactId', source->>'companyId', source->>'dealId');
    record_entity := CASE
      WHEN source->>'contactId' IS NOT NULL THEN 'CONTACT'
      WHEN source->>'companyId' IS NOT NULL THEN 'COMPANY'
      ELSE 'DEAL'
    END;
    field_id := source->>'fieldId';
    IF TG_OP = 'DELETE' AND (
      NOT EXISTS (SELECT 1 FROM "fieldDefinition" WHERE id = field_id) OR
      (record_entity = 'CONTACT' AND NOT EXISTS (SELECT 1 FROM "contact" WHERE id = record_id)) OR
      (record_entity = 'COMPANY' AND NOT EXISTS (SELECT 1 FROM "company" WHERE id = record_id)) OR
      (record_entity = 'DEAL' AND NOT EXISTS (SELECT 1 FROM "deal" WHERE id = record_id))
    ) THEN
      RETURN NULL;
    END IF;
    IF TG_OP <> 'INSERT' THEN old_row := jsonb_strip_nulls(to_jsonb(OLD) - TG_ARGV); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := jsonb_strip_nulls(to_jsonb(NEW) - TG_ARGV); END IF;
  ELSE
    record_id := source->>'id';
    record_entity := upper(TG_TABLE_NAME)::"FieldEntity";
    IF TG_OP = 'DELETE' THEN
      DELETE FROM "recordChange" WHERE entity = record_entity AND "recordId" = record_id;
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      change_operation := 'CREATE';
    ELSE
      old_row := to_jsonb(OLD) - TG_ARGV;
      new_row := to_jsonb(NEW) - TG_ARGV;
    END IF;
  END IF;

  IF change_operation = 'UPDATE' THEN
    SELECT coalesce(jsonb_object_agg(k, old_row->k), '{}'::jsonb),
           coalesce(jsonb_object_agg(k, new_row->k), '{}'::jsonb)
      INTO change_before, change_after
      FROM (SELECT jsonb_object_keys(old_row) AS k UNION SELECT jsonb_object_keys(new_row)) AS changed
     WHERE (old_row->k) IS DISTINCT FROM (new_row->k);
    IF change_before = '{}'::jsonb AND change_after = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  IF actor LIKE 'USER:%' THEN
    actor_kind := 'USER';
    actor_id := split_part(actor, ':', 2);
    actor_user_id := actor_id;
  ELSIF actor LIKE 'API_KEY:%' THEN
    actor_kind := 'API_KEY';
    actor_id := split_part(actor, ':', 2);
    actor_user_id := nullif(split_part(actor, ':', 3), '');
  ELSIF actor = 'AGENT' THEN
    actor_kind := 'AGENT';
  END IF;

  INSERT INTO "recordChange" (entity, "recordId", "fieldId", operation, before, after, "actorKind", "actorId", "actorUserId", "createdAt")
  VALUES (record_entity, record_id, field_id, change_operation, change_before, change_after, actor_kind, actor_id, actor_user_id, clock_timestamp() AT TIME ZONE 'UTC');
  RETURN NULL;
END;
$$;

CREATE TRIGGER crm_record_change AFTER INSERT OR UPDATE OR DELETE ON "contact"
  FOR EACH ROW EXECUTE FUNCTION crm_record_change('updatedAt', 'lastActivityAt', 'enrichmentStatus', 'enrichedAt', 'enrichmentError', 'socialsCheckedAt');

CREATE TRIGGER crm_record_change AFTER INSERT OR UPDATE OR DELETE ON "company"
  FOR EACH ROW EXECUTE FUNCTION crm_record_change('updatedAt', 'lastActivityAt', 'enrichmentStatus', 'enrichedAt', 'enrichmentError');

CREATE TRIGGER crm_record_change AFTER INSERT OR UPDATE OR DELETE ON "deal"
  FOR EACH ROW EXECUTE FUNCTION crm_record_change('updatedAt', 'lastActivityAt', 'stageChangedAt', 'baseAmount', 'baseCurrency', 'fxRate', 'fxRateAt');

CREATE TRIGGER crm_record_change AFTER INSERT OR UPDATE OR DELETE ON "fieldValue"
  FOR EACH ROW EXECUTE FUNCTION crm_record_change('id', 'fieldId', 'companyId', 'contactId', 'dealId', 'updatedAt');
