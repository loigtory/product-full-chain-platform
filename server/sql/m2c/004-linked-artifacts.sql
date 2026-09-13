-- R2 additive migration. Existing content and confirmations are never fabricated.
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge',
 'artifact_versions','artifact_groups','artifact_group_sources','artifact_proposals','artifact_confirmations','artifact_impacts'));
ALTER TABLE req_versions ADD CONSTRAINT req_versions_req_identity UNIQUE(tenant_id,req_id,id);
CREATE TABLE artifact_versions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('prototype','acceptance')),version int NOT NULL CHECK(version>0),parent_id uuid,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,kind,version),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,parent_id) REFERENCES artifact_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
CREATE TABLE artifact_groups (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,version int NOT NULL CHECK(version>0),parent_id uuid,
 prototype_id uuid NOT NULL,prd_id uuid NOT NULL,acceptance_id uuid NOT NULL,
 input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),inputs jsonb NOT NULL,
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='array' AND jsonb_array_length(rules)<=100),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,version),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,parent_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,prototype_id) REFERENCES artifact_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,acceptance_id) REFERENCES artifact_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,prd_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
ALTER TABLE reqs ADD COLUMN current_artifact_group_id uuid,
 ADD COLUMN artifact_business_epoch int NOT NULL DEFAULT 0 CHECK(artifact_business_epoch>=0),
 ADD COLUMN artifact_design_epoch int NOT NULL DEFAULT 0 CHECK(artifact_design_epoch>=0),
 ADD FOREIGN KEY(tenant_id,id,current_artifact_group_id) REFERENCES artifact_groups(tenant_id,req_id,id);
CREATE TABLE artifact_group_sources (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,group_id uuid NOT NULL,public_id text NOT NULL,
 material_version_id uuid,req_version_id uuid,source_data jsonb NOT NULL,
 CHECK((material_version_id IS NOT NULL)::int+(req_version_id IS NOT NULL)::int=1),
 UNIQUE(tenant_id,public_id),
 FOREIGN KEY(tenant_id,req_id,group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,material_version_id) REFERENCES material_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,req_version_id) REFERENCES req_versions(tenant_id,req_id,id));
CREATE TABLE artifact_proposals (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,base_group_id uuid,
 input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),
 inputs jsonb NOT NULL,payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=524288),source jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('INCOMPLETE','READY','APPLIED','REJECTED','SUPERSEDED')),
 supersedes_id uuid,result_group_id uuid,handled_by uuid,reason text,handled_at timestamptz,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,base_group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,result_group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,supersedes_id) REFERENCES artifact_proposals(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,handled_by) REFERENCES members(tenant_id,id),
 CHECK((state='APPLIED')=(result_group_id IS NOT NULL)));
CREATE TABLE artifact_confirmations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,group_id uuid NOT NULL,public_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('BUSINESS','DESIGN')),design_version_id uuid,business_epoch int NOT NULL,design_epoch int NOT NULL,
 input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),scope jsonb,
 scope_fingerprint text CHECK(scope_fingerprint ~ '^[a-f0-9]{64}$'),comment text NOT NULL,
 preview_review text NOT NULL DEFAULT '',member_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('owner','executor')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),
 CHECK((kind='DESIGN')=(design_version_id IS NOT NULL AND scope IS NOT NULL AND scope_fingerprint IS NOT NULL)),
 FOREIGN KEY(tenant_id,req_id,group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,design_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES members(tenant_id,id));
CREATE TABLE artifact_impacts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,
 reason text NOT NULL,return_stage text NOT NULL CHECK(return_stage IN ('req','design')),
 before_group_id uuid,after_group_id uuid,business_epoch int NOT NULL,design_epoch int NOT NULL,
 detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,business_epoch,design_epoch),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,before_group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,after_group_id) REFERENCES artifact_groups(tenant_id,req_id,id));
ALTER TABLE message_references ADD COLUMN artifact_version_id uuid,
 ADD FOREIGN KEY(tenant_id,artifact_version_id) REFERENCES artifact_versions(tenant_id,id);
ALTER TABLE message_references DROP CONSTRAINT message_references_check;
ALTER TABLE message_references ADD CONSTRAINT message_references_one_target CHECK
 ((material_version_id IS NOT NULL)::int+(req_version_id IS NOT NULL)::int+(artifact_version_id IS NOT NULL)::int=1);
-- Discover only the two checks that refer to snapshot_version, scoped to this migration's table.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='run_plans'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%snapshot_version%'
 LOOP EXECUTE format('ALTER TABLE run_plans DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;
ALTER TABLE run_plans ADD CONSTRAINT run_plans_snapshot_version_check CHECK(snapshot_version IN (1,2)),
 ADD CONSTRAINT run_plans_snapshot_consistency CHECK
 ((snapshot_version IS NULL AND context_snapshot IS NULL AND context_fingerprint IS NULL) OR
 (snapshot_version IN (1,2) AND jsonb_typeof(context_snapshot)='object' AND octet_length(context_snapshot::text)<=524288 AND context_fingerprint IS NOT NULL));
CREATE INDEX idx_artifact_proposals_req ON artifact_proposals(tenant_id,req_id,created_at,id);
CREATE INDEX idx_artifact_groups_req ON artifact_groups(tenant_id,req_id,version);
CREATE INDEX idx_artifact_confirmations_req ON artifact_confirmations(tenant_id,req_id,created_at,id);
CREATE FUNCTION artifact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'ARTIFACT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER artifact_versions_immutable BEFORE UPDATE OR DELETE ON artifact_versions FOR EACH ROW EXECUTE FUNCTION artifact_immutable();
CREATE TRIGGER artifact_groups_immutable BEFORE UPDATE OR DELETE ON artifact_groups FOR EACH ROW EXECUTE FUNCTION artifact_immutable();
CREATE TRIGGER artifact_sources_immutable BEFORE UPDATE OR DELETE ON artifact_group_sources FOR EACH ROW EXECUTE FUNCTION artifact_immutable();
CREATE TRIGGER artifact_confirmations_immutable BEFORE UPDATE OR DELETE ON artifact_confirmations FOR EACH ROW EXECUTE FUNCTION artifact_immutable();
CREATE FUNCTION artifact_proposal_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.payload,NEW.inputs,NEW.source,NEW.base_group_id,NEW.input_fingerprint,NEW.req_id,NEW.tenant_id,NEW.created_by,NEW.supersedes_id)
 IS DISTINCT FROM (OLD.payload,OLD.inputs,OLD.source,OLD.base_group_id,OLD.input_fingerprint,OLD.req_id,OLD.tenant_id,OLD.created_by,OLD.supersedes_id)
 THEN RAISE EXCEPTION 'ARTIFACT_PROPOSAL_CONTENT_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER artifact_proposal_immutable BEFORE UPDATE ON artifact_proposals FOR EACH ROW EXECUTE FUNCTION artifact_proposal_content_immutable();
CREATE TRIGGER artifact_proposal_no_delete BEFORE DELETE ON artifact_proposals FOR EACH ROW EXECUTE FUNCTION artifact_immutable();
CREATE FUNCTION artifact_prd_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM artifact_groups WHERE tenant_id=OLD.tenant_id AND prd_id=OLD.id)
 AND (TG_OP='DELETE' OR (NEW.content,NEW.stage,NEW.req_id,NEW.tenant_id,NEW.version,NEW.base_version_id)
 IS DISTINCT FROM (OLD.content,OLD.stage,OLD.req_id,OLD.tenant_id,OLD.version,OLD.base_version_id))
 THEN RAISE EXCEPTION 'ARTIFACT_PRD_CONTENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER artifact_prd_content_immutable BEFORE UPDATE OR DELETE ON req_versions FOR EACH ROW EXECUTE FUNCTION artifact_prd_content_guard();
CREATE FUNCTION artifact_group_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM artifact_versions WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND id=NEW.prototype_id AND kind='prototype')
 OR NOT EXISTS(SELECT 1 FROM artifact_versions WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND id=NEW.acceptance_id AND kind='acceptance')
 OR NOT EXISTS(SELECT 1 FROM req_versions WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND id=NEW.prd_id AND stage='req')
 THEN RAISE EXCEPTION 'ARTIFACT_GROUP_KIND_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER artifact_group_kind BEFORE INSERT ON artifact_groups FOR EACH ROW EXECUTE FUNCTION artifact_group_kind_guard();
CREATE FUNCTION artifact_source_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.material_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v JOIN materials m ON m.tenant_id=v.tenant_id AND m.id=v.material_id WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.material_version_id AND m.req_id=NEW.req_id)
 THEN RAISE EXCEPTION 'ARTIFACT_SOURCE_OWNER_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER artifact_source_owner BEFORE INSERT ON artifact_group_sources FOR EACH ROW EXECUTE FUNCTION artifact_source_owner_guard();
