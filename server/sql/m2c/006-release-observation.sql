-- Explicit 006; manual USER_REPORTED records only. No automatic execution or data backfill.
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge','artifact_versions','artifact_groups','artifact_group_sources','artifact_proposals','artifact_confirmations','artifact_impacts',
 'test_suites','test_cases','delivery_baselines','test_batches','test_results','defects','defect_events','product_acceptances','verification_refs','release_plans','release_reviews','release_attempts','release_result_events','release_observations','release_metric_events','release_followups','release_followup_events','final_acceptances','release_returns','release_refs'));
ALTER TABLE messages DROP CONSTRAINT messages_stage_check;
ALTER TABLE messages ADD CONSTRAINT messages_stage_check CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe'));
CREATE TABLE release_plans (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,version int NOT NULL CHECK(version>0),parent_id uuid,release_epoch int NOT NULL CHECK(release_epoch>=0),baseline_id uuid NOT NULL,content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),completeness text NOT NULL CHECK(completeness IN ('DRAFT','READY')),missing_fields jsonb NOT NULL,review_state text NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK(review_state IN ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED','SUPERSEDED')),submitted_at timestamptz,expires_at timestamptz,
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,parent_id) REFERENCES release_plans(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,baseline_id) REFERENCES delivery_baselines(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,version)
);
CREATE INDEX release_plans_history ON release_plans(tenant_id,req_id,created_at DESC);
CREATE TABLE release_reviews (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,plan_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),comment text NOT NULL CHECK(length(btrim(comment)) BETWEEN 1 AND 4000),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,plan_id) REFERENCES release_plans(tenant_id,req_id,id)
);
CREATE INDEX release_reviews_history ON release_reviews(tenant_id,req_id,created_at DESC);
CREATE TABLE release_attempts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,plan_id uuid NOT NULL,review_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('DEPLOY','ROLLBACK')),previous_attempt_id uuid,
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,plan_id) REFERENCES release_plans(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,review_id) REFERENCES release_reviews(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,previous_attempt_id) REFERENCES release_attempts(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,plan_id,id)
);
CREATE INDEX release_attempts_history ON release_attempts(tenant_id,req_id,created_at DESC);
CREATE TABLE release_result_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,attempt_id uuid NOT NULL,plan_id uuid NOT NULL,previous_event_id uuid,status text NOT NULL CHECK(status IN ('SUCCESS','FAILED','UNKNOWN')),content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),report_version_id uuid,
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,previous_event_id) REFERENCES release_result_events(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,report_version_id) REFERENCES req_versions(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,plan_id,attempt_id) REFERENCES release_attempts(tenant_id,req_id,plan_id,id),UNIQUE(tenant_id,req_id,attempt_id,previous_event_id)
);
CREATE INDEX release_result_events_history ON release_result_events(tenant_id,req_id,created_at DESC);
CREATE TABLE release_observations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,plan_id uuid NOT NULL,attempt_id uuid NOT NULL,result_id uuid NOT NULL,started_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>started_at),state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','STOPPED','CLOSED')),stop_reason text,
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,plan_id) REFERENCES release_plans(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,result_id) REFERENCES release_result_events(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,plan_id,attempt_id) REFERENCES release_attempts(tenant_id,req_id,plan_id,id),UNIQUE(tenant_id,req_id,attempt_id)
);
CREATE INDEX release_observations_history ON release_observations(tenant_id,req_id,created_at DESC);
CREATE TABLE release_metric_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,observation_id uuid NOT NULL,content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,observation_id) REFERENCES release_observations(tenant_id,req_id,id)
);
CREATE INDEX release_metric_events_history ON release_metric_events(tenant_id,req_id,created_at DESC);
CREATE TABLE release_followups (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,observation_id uuid NOT NULL,content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,observation_id) REFERENCES release_observations(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,observation_id,id)
);
CREATE INDEX release_followups_history ON release_followups(tenant_id,req_id,created_at DESC);
CREATE TABLE release_followup_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,observation_id uuid NOT NULL,followup_id uuid NOT NULL,content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,observation_id,followup_id) REFERENCES release_followups(tenant_id,req_id,observation_id,id)
);
CREATE INDEX release_followup_events_history ON release_followup_events(tenant_id,req_id,created_at DESC);
CREATE TABLE final_acceptances (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,observation_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')),content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=524288),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),report_version_id uuid NOT NULL,
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,observation_id) REFERENCES release_observations(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,report_version_id) REFERENCES req_versions(tenant_id,req_id,id)
);
CREATE INDEX final_acceptances_history ON final_acceptances(tenant_id,req_id,created_at DESC);
CREATE TABLE release_returns (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,plan_id uuid NOT NULL,return_stage text NOT NULL CHECK(return_stage IN ('req','design','dev')),comment text NOT NULL CHECK(length(btrim(comment)) BETWEEN 1 AND 4000),release_epoch int NOT NULL CHECK(release_epoch>=0),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,req_id,plan_id) REFERENCES release_plans(tenant_id,req_id,id)
);
CREATE INDEX release_returns_history ON release_returns(tenant_id,req_id,created_at DESC);
CREATE TABLE release_refs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,material_version_id uuid NOT NULL,plan_id uuid,result_id uuid,metric_event_id uuid,followup_event_id uuid,final_id uuid,source_data jsonb NOT NULL CHECK(jsonb_typeof(source_data)='object'),CHECK(num_nonnulls(plan_id,result_id,metric_event_id,followup_event_id,final_id)=1),
 created_by uuid NOT NULL,created_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),source text NOT NULL DEFAULT 'USER_REPORTED' CHECK(source='USER_REPORTED'),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),FOREIGN KEY(tenant_id,material_version_id) REFERENCES material_versions(tenant_id,id),FOREIGN KEY(tenant_id,req_id,plan_id) REFERENCES release_plans(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,result_id) REFERENCES release_result_events(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,metric_event_id) REFERENCES release_metric_events(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,followup_event_id) REFERENCES release_followup_events(tenant_id,req_id,id),FOREIGN KEY(tenant_id,req_id,final_id) REFERENCES final_acceptances(tenant_id,req_id,id)
);
CREATE INDEX release_refs_history ON release_refs(tenant_id,req_id,created_at DESC);
ALTER TABLE reqs ADD COLUMN release_epoch int NOT NULL DEFAULT 0 CHECK(release_epoch>=0),ADD COLUMN current_release_plan_id uuid,ADD COLUMN current_release_id uuid,ADD COLUMN current_observation_id uuid,ADD FOREIGN KEY(tenant_id,id,current_release_plan_id) REFERENCES release_plans(tenant_id,req_id,id),ADD FOREIGN KEY(tenant_id,id,current_release_id) REFERENCES release_plans(tenant_id,req_id,id),ADD FOREIGN KEY(tenant_id,id,current_observation_id) REFERENCES release_observations(tenant_id,req_id,id);
CREATE UNIQUE INDEX release_one_approval ON release_plans(tenant_id,req_id) WHERE review_state='APPROVED';
CREATE UNIQUE INDEX release_first_event ON release_result_events(tenant_id,req_id,attempt_id) WHERE previous_event_id IS NULL;
CREATE UNIQUE INDEX release_one_final ON final_acceptances(tenant_id,req_id) WHERE decision='ACCEPTED';
CREATE FUNCTION release_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RELEASE_FACT_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE FUNCTION release_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_TABLE_NAME='release_plans' THEN IF (to_jsonb(NEW)-ARRAY['review_state','submitted_at','expires_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['review_state','submitted_at','expires_at']) THEN RAISE EXCEPTION 'RELEASE_PLAN_IMMUTABLE' USING ERRCODE='23514'; END IF; ELSE IF (to_jsonb(NEW)-ARRAY['state','stop_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','stop_reason']) THEN RAISE EXCEPTION 'OBSERVATION_IMMUTABLE' USING ERRCODE='23514'; END IF; END IF; RETURN NEW; END $$;
CREATE TRIGGER release_plans_guard BEFORE UPDATE ON release_plans FOR EACH ROW EXECUTE FUNCTION release_header_guard();
CREATE TRIGGER release_plans_no_delete BEFORE DELETE ON release_plans FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_reviews_immutable BEFORE UPDATE OR DELETE ON release_reviews FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_attempts_immutable BEFORE UPDATE OR DELETE ON release_attempts FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_result_events_immutable BEFORE UPDATE OR DELETE ON release_result_events FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_observations_guard BEFORE UPDATE ON release_observations FOR EACH ROW EXECUTE FUNCTION release_header_guard();
CREATE TRIGGER release_observations_no_delete BEFORE DELETE ON release_observations FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_metric_events_immutable BEFORE UPDATE OR DELETE ON release_metric_events FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_followups_immutable BEFORE UPDATE OR DELETE ON release_followups FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_followup_events_immutable BEFORE UPDATE OR DELETE ON release_followup_events FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER final_acceptances_immutable BEFORE UPDATE OR DELETE ON final_acceptances FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_returns_immutable BEFORE UPDATE OR DELETE ON release_returns FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE TRIGGER release_refs_immutable BEFORE UPDATE OR DELETE ON release_refs FOR EACH ROW EXECUTE FUNCTION release_immutable();
CREATE FUNCTION release_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.stage IN ('release','observe') AND (EXISTS(SELECT 1 FROM release_result_events WHERE tenant_id=OLD.tenant_id AND req_id=OLD.req_id AND report_version_id=OLD.id) OR EXISTS(SELECT 1 FROM final_acceptances WHERE tenant_id=OLD.tenant_id AND req_id=OLD.req_id AND report_version_id=OLD.id)) AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['stale']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['stale'])) THEN RAISE EXCEPTION 'RELEASE_REPORT_IMMUTABLE' USING ERRCODE='23514'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER release_reports_guard BEFORE UPDATE OR DELETE ON req_versions FOR EACH ROW EXECUTE FUNCTION release_version_guard();
CREATE FUNCTION release_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM material_versions v JOIN materials m ON m.tenant_id=v.tenant_id AND m.id=v.material_id WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.material_version_id AND m.req_id=NEW.req_id AND m.usage='attachment' AND v.file_id IS NOT NULL) THEN RAISE EXCEPTION 'RELEASE_REFERENCE_OWNER' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER release_refs_owner BEFORE INSERT ON release_refs FOR EACH ROW EXECUTE FUNCTION release_reference_guard();

-- Composite parent identity prevents same-requirement cross-plan and cross-attempt references.
ALTER TABLE release_reviews ADD UNIQUE(tenant_id,req_id,plan_id,id);
ALTER TABLE release_attempts ADD FOREIGN KEY(tenant_id,req_id,plan_id,review_id) REFERENCES release_reviews(tenant_id,req_id,plan_id,id);
ALTER TABLE release_result_events ADD UNIQUE(tenant_id,req_id,attempt_id,id),ADD FOREIGN KEY(tenant_id,req_id,attempt_id,previous_event_id) REFERENCES release_result_events(tenant_id,req_id,attempt_id,id);
ALTER TABLE release_observations ADD FOREIGN KEY(tenant_id,req_id,attempt_id,result_id) REFERENCES release_result_events(tenant_id,req_id,attempt_id,id);

-- Per-stream optimistic chains: a stale event cannot silently replace a newer judgment.
ALTER TABLE release_metric_events ADD COLUMN stream_key text NOT NULL, ADD COLUMN event_sequence int NOT NULL CHECK(event_sequence>0), ADD COLUMN previous_event_id uuid,
 ADD CONSTRAINT release_metric_chain_unique UNIQUE(tenant_id,req_id,observation_id,stream_key,event_sequence),
 ADD UNIQUE(tenant_id,req_id,observation_id,stream_key,id),
 ADD CONSTRAINT release_metric_chain_owner FOREIGN KEY(tenant_id,req_id,observation_id,stream_key,previous_event_id) REFERENCES release_metric_events(tenant_id,req_id,observation_id,stream_key,id),
 ADD CHECK((event_sequence=1)=(previous_event_id IS NULL));
ALTER TABLE release_followup_events ADD COLUMN event_sequence int NOT NULL CHECK(event_sequence>0), ADD COLUMN previous_event_id uuid,
 ADD CONSTRAINT release_followup_chain_unique UNIQUE(tenant_id,req_id,observation_id,followup_id,event_sequence),
 ADD UNIQUE(tenant_id,req_id,observation_id,followup_id,id),
 ADD CONSTRAINT release_followup_chain_owner FOREIGN KEY(tenant_id,req_id,observation_id,followup_id,previous_event_id) REFERENCES release_followup_events(tenant_id,req_id,observation_id,followup_id,id),
 ADD CHECK((event_sequence=1)=(previous_event_id IS NULL));
