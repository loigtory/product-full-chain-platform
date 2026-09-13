-- R3 explicit additive migration. No existing facts or test outcomes are fabricated.
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge','artifact_versions','artifact_groups','artifact_group_sources','artifact_proposals','artifact_confirmations','artifact_impacts',
 'test_suites','test_cases','delivery_baselines','test_batches','test_results','defects','defect_events','product_acceptances','verification_refs'));
ALTER TABLE messages DROP CONSTRAINT messages_stage_check;
ALTER TABLE messages ADD CONSTRAINT messages_stage_check CHECK(stage IN ('idea','req','design','dev','test','accept','release'));
CREATE TABLE test_suites (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,group_id uuid NOT NULL,parent_id uuid,
 version int NOT NULL CHECK(version>0),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 4000),
 status text NOT NULL CHECK(status IN ('INCOMPLETE','READY')),gaps jsonb NOT NULL CHECK(jsonb_typeof(gaps)='array'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,id,group_id),UNIQUE(tenant_id,req_id,version),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,group_id) REFERENCES artifact_groups(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,parent_id) REFERENCES test_suites(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
CREATE TABLE test_cases (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,suite_id uuid NOT NULL,
 case_id text NOT NULL CHECK(length(case_id) BETWEEN 1 AND 160),ordinal int NOT NULL CHECK(ordinal BETWEEN 1 AND 200),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,suite_id,case_id),UNIQUE(tenant_id,req_id,suite_id,ordinal),
 FOREIGN KEY(tenant_id,req_id,suite_id) REFERENCES test_suites(tenant_id,req_id,id));
CREATE TABLE delivery_baselines (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,group_id uuid NOT NULL,suite_id uuid NOT NULL,
 dev_version_id uuid NOT NULL,business_confirmation_id uuid NOT NULL,design_confirmation_id uuid NOT NULL,project_id uuid,
 verification_epoch int NOT NULL CHECK(verification_epoch>=0),input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 subject jsonb NOT NULL CHECK(jsonb_typeof(subject)='object' AND octet_length(subject::text)<=524288),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,id,suite_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,suite_id,group_id) REFERENCES test_suites(tenant_id,req_id,id,group_id),
 FOREIGN KEY(tenant_id,req_id,dev_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,business_confirmation_id) REFERENCES artifact_confirmations(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,design_confirmation_id) REFERENCES artifact_confirmations(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
ALTER TABLE reqs ADD COLUMN current_test_suite_id uuid,ADD COLUMN current_delivery_baseline_id uuid,
 ADD COLUMN verification_epoch int NOT NULL DEFAULT 0 CHECK(verification_epoch>=0),
 ADD FOREIGN KEY(tenant_id,id,current_test_suite_id) REFERENCES test_suites(tenant_id,req_id,id),
 ADD FOREIGN KEY(tenant_id,id,current_delivery_baseline_id) REFERENCES delivery_baselines(tenant_id,req_id,id);
CREATE TABLE test_batches (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,baseline_id uuid NOT NULL,suite_id uuid NOT NULL,
 environment text NOT NULL CHECK(length(environment) BETWEEN 1 AND 4000),source text NOT NULL CHECK(source='USER_REPORTED'),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','COMPLETED','CANCELLED')),report_version_id uuid,finalized_at timestamptz,cancel_reason text CHECK(length(cancel_reason) BETWEEN 1 AND 4000),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,id,suite_id),UNIQUE(tenant_id,req_id,id,baseline_id),
 FOREIGN KEY(tenant_id,req_id,baseline_id,suite_id) REFERENCES delivery_baselines(tenant_id,req_id,id,suite_id),
 FOREIGN KEY(tenant_id,req_id,report_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),
 CHECK((state='CANCELLED')=(cancel_reason IS NOT NULL)),CHECK((state='COMPLETED')=(report_version_id IS NOT NULL)),CHECK((state='OPEN')=(finalized_at IS NULL)));
CREATE TABLE test_results (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,batch_id uuid NOT NULL,suite_id uuid NOT NULL,case_id text NOT NULL,
 sequence int NOT NULL CHECK(sequence BETWEEN 1 AND 100),previous_result_id uuid,
 status text NOT NULL CHECK(status IN ('PASS','FAIL','BLOCKED','NOT_RUN')),source text NOT NULL CHECK(source='USER_REPORTED'),
 actual text NOT NULL CHECK(length(actual)<=4000),reason text NOT NULL CHECK(length(reason)<=4000),executed_at timestamptz NOT NULL,
 registered_by uuid NOT NULL,registered_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status IN ('PASS','FAIL') AND length(btrim(actual))>0) OR (status IN ('BLOCKED','NOT_RUN') AND length(btrim(reason))>0)),
 CHECK((sequence=1)=(previous_result_id IS NULL)),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,batch_id,case_id,sequence),UNIQUE(tenant_id,req_id,batch_id,case_id,id),
 FOREIGN KEY(tenant_id,req_id,batch_id,suite_id) REFERENCES test_batches(tenant_id,req_id,id,suite_id),
 FOREIGN KEY(tenant_id,req_id,suite_id,case_id) REFERENCES test_cases(tenant_id,req_id,suite_id,case_id),
 FOREIGN KEY(tenant_id,req_id,batch_id,case_id,previous_result_id) REFERENCES test_results(tenant_id,req_id,batch_id,case_id,id),
 FOREIGN KEY(tenant_id,registered_by) REFERENCES members(tenant_id,id));
CREATE TABLE defects (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,source_result_id uuid NOT NULL,case_id text NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 4000),description text NOT NULL CHECK(length(description) BETWEEN 1 AND 4000),
 state text NOT NULL CHECK(state IN ('OPEN','RESOLVED','REOPEN','CLOSED')),resolved_dev_version_id uuid,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,source_result_id),
 FOREIGN KEY(tenant_id,req_id,source_result_id) REFERENCES test_results(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,resolved_dev_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
CREATE TABLE defect_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,defect_id uuid NOT NULL,sequence int NOT NULL CHECK(sequence>0),
 state text NOT NULL CHECK(state IN ('OPEN','RESOLVED','REOPEN','CLOSED')),comment text NOT NULL CHECK(length(comment) BETWEEN 1 AND 4000),
 result_id uuid,dev_version_id uuid,member_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,defect_id,sequence),
 FOREIGN KEY(tenant_id,req_id,defect_id) REFERENCES defects(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,result_id) REFERENCES test_results(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,dev_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES members(tenant_id,id));
CREATE TABLE product_acceptances (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,baseline_id uuid NOT NULL,batch_id uuid NOT NULL,report_version_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')),checks jsonb NOT NULL CHECK(jsonb_typeof(checks)='object'),
 comment text NOT NULL CHECK(length(comment) BETWEEN 1 AND 4000),risks text NOT NULL CHECK(length(risks) BETWEEN 1 AND 4000),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,batch_id,baseline_id) REFERENCES test_batches(tenant_id,req_id,id,baseline_id),
 FOREIGN KEY(tenant_id,req_id,report_version_id) REFERENCES req_versions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES members(tenant_id,id),
 CHECK(decision='REJECTED' OR (checks @> '{"functionality":true,"exceptions":true,"evidence":true}'::jsonb)));
CREATE TABLE verification_refs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,material_version_id uuid NOT NULL,
 baseline_id uuid,result_id uuid,defect_event_id uuid,acceptance_id uuid,source_data jsonb NOT NULL CHECK(jsonb_typeof(source_data)='object'),
 CHECK(num_nonnulls(baseline_id,result_id,defect_event_id,acceptance_id)=1),
 UNIQUE(tenant_id,public_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,material_version_id) REFERENCES material_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,baseline_id) REFERENCES delivery_baselines(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,result_id) REFERENCES test_results(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,defect_event_id) REFERENCES defect_events(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,acceptance_id) REFERENCES product_acceptances(tenant_id,req_id,id));
CREATE INDEX idx_test_suites_req ON test_suites(tenant_id,req_id,version);
CREATE INDEX idx_delivery_baselines_req ON delivery_baselines(tenant_id,req_id,created_at,id);
CREATE INDEX idx_test_batches_req ON test_batches(tenant_id,req_id,created_at,id);
CREATE INDEX idx_test_results_batch ON test_results(tenant_id,req_id,batch_id,case_id,sequence);
CREATE INDEX idx_defects_req ON defects(tenant_id,req_id,state,created_at,id);
CREATE INDEX idx_product_acceptances_req ON product_acceptances(tenant_id,req_id,created_at,id);
CREATE INDEX idx_verification_refs_req ON verification_refs(tenant_id,req_id);
CREATE FUNCTION verification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'VERIFICATION_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER test_suites_immutable BEFORE UPDATE OR DELETE ON test_suites FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER test_cases_immutable BEFORE UPDATE OR DELETE ON test_cases FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER delivery_baselines_immutable BEFORE UPDATE OR DELETE ON delivery_baselines FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER test_results_immutable BEFORE UPDATE OR DELETE ON test_results FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER defect_events_immutable BEFORE UPDATE OR DELETE ON defect_events FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER product_acceptances_immutable BEFORE UPDATE OR DELETE ON product_acceptances FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER verification_refs_immutable BEFORE UPDATE OR DELETE ON verification_refs FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE FUNCTION verification_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VERIFICATION_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='test_batches' THEN
  IF OLD.state<>'OPEN' OR (to_jsonb(NEW)-ARRAY['state','report_version_id','finalized_at','cancel_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','report_version_id','finalized_at','cancel_reason'])
  THEN RAISE EXCEPTION 'TEST_BATCH_FINAL' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','resolved_dev_version_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','resolved_dev_version_id'])
  THEN RAISE EXCEPTION 'DEFECT_HEADER_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER test_batches_header BEFORE UPDATE OR DELETE ON test_batches FOR EACH ROW EXECUTE FUNCTION verification_header_guard();
CREATE TRIGGER defects_header BEFORE UPDATE OR DELETE ON defects FOR EACH ROW EXECUTE FUNCTION verification_header_guard();
CREATE FUNCTION verification_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM delivery_baselines WHERE tenant_id=OLD.tenant_id AND dev_version_id=OLD.id)
 OR EXISTS(SELECT 1 FROM test_batches WHERE tenant_id=OLD.tenant_id AND report_version_id=OLD.id)
 OR EXISTS(SELECT 1 FROM product_acceptances WHERE tenant_id=OLD.tenant_id AND report_version_id=OLD.id)
 THEN
  IF TG_OP='DELETE' OR (NEW.content,NEW.stage,NEW.req_id,NEW.tenant_id,NEW.version,NEW.base_version_id)
   IS DISTINCT FROM (OLD.content,OLD.stage,OLD.req_id,OLD.tenant_id,OLD.version,OLD.base_version_id)
  THEN RAISE EXCEPTION 'VERIFICATION_VERSION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER verification_version_immutable BEFORE UPDATE OR DELETE ON req_versions FOR EACH ROW EXECUTE FUNCTION verification_version_guard();
CREATE FUNCTION verification_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM material_versions v JOIN materials m ON m.tenant_id=v.tenant_id AND m.id=v.material_id WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.material_version_id AND m.req_id=NEW.req_id AND m.usage='attachment' AND v.file_id IS NOT NULL)
 THEN RAISE EXCEPTION 'VERIFICATION_REFERENCE_OWNER_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER verification_reference_owner BEFORE INSERT ON verification_refs FOR EACH ROW EXECUTE FUNCTION verification_reference_guard();
CREATE FUNCTION verification_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM req_versions WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND id=NEW.dev_version_id AND stage='dev')
 OR NOT EXISTS(SELECT 1 FROM artifact_confirmations WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND group_id=NEW.group_id AND id=NEW.business_confirmation_id AND kind='BUSINESS')
 OR NOT EXISTS(SELECT 1 FROM artifact_confirmations WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND group_id=NEW.group_id AND id=NEW.design_confirmation_id AND kind='DESIGN')
 OR NOT EXISTS(SELECT 1 FROM test_suites WHERE tenant_id=NEW.tenant_id AND req_id=NEW.req_id AND id=NEW.suite_id AND status='READY')
 THEN RAISE EXCEPTION 'TEST_BASELINE_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER verification_baseline_kind BEFORE INSERT ON delivery_baselines FOR EACH ROW EXECUTE FUNCTION verification_baseline_guard();
