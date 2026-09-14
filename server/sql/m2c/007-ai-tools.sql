-- Additive AI/tool facts. No provider credentials or automatic replay of dispatched jobs.
CREATE TABLE agent_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, req_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider='codex'), model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160),
 provider_thread_id text CHECK(length(provider_thread_id) BETWEEN 1 AND 200),
 connection_hash text NOT NULL CHECK(connection_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED','UNKNOWN')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,req_id,id), UNIQUE(provider_thread_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));

CREATE TABLE agent_jobs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,session_id uuid,
 command_id text NOT NULL CHECK(length(command_id) BETWEEN 1 AND 160),
 kind text NOT NULL CHECK(kind IN ('TEXT','ARTIFACTS','EXTRACT','EXECUTE','TEST')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','WAITING_APPROVAL','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN')),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=1048576),
 result jsonb CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=1048576),
 error_code text CHECK(error_code ~ '^[A-Z_0-9]{1,100}$'),
 owner_id uuid,lease_until timestamptz,dispatched_at timestamptz,
 next_sequence int NOT NULL DEFAULT 0 CHECK(next_sequence BETWEEN 0 AND 10000),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,id,session_id),UNIQUE(tenant_id,req_id,command_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,session_id) REFERENCES agent_sessions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),
 CHECK((owner_id IS NULL)=(lease_until IS NULL)),
 CHECK(state NOT IN ('RUNNING','WAITING_APPROVAL') OR owner_id IS NOT NULL));
CREATE INDEX agent_jobs_queue ON agent_jobs(state,created_at,id);
CREATE INDEX agent_jobs_req ON agent_jobs(tenant_id,req_id,created_at,id);
CREATE UNIQUE INDEX agent_one_active_session ON agent_jobs(session_id) WHERE session_id IS NOT NULL AND state IN ('QUEUED','RUNNING','WAITING_APPROVAL');

CREATE TABLE agent_turns (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,job_id uuid NOT NULL,session_id uuid NOT NULL,
 provider_turn_id text NOT NULL CHECK(length(provider_turn_id) BETWEEN 1 AND 200),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 output_hash text CHECK(output_hash ~ '^[a-f0-9]{64}$'),usage jsonb CHECK(jsonb_typeof(usage)='object'),
 state text NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN')),
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(tenant_id,req_id,id),UNIQUE(session_id,provider_turn_id),UNIQUE(job_id),
 FOREIGN KEY(tenant_id,req_id,job_id,session_id) REFERENCES agent_jobs(tenant_id,req_id,id,session_id),
 FOREIGN KEY(tenant_id,req_id,session_id) REFERENCES agent_sessions(tenant_id,req_id,id));

CREATE TABLE agent_events (
 tenant_id uuid NOT NULL,req_id uuid NOT NULL,job_id uuid NOT NULL,sequence int NOT NULL CHECK(sequence BETWEEN 1 AND 10000),
 type text NOT NULL CHECK(type IN ('queued','started','delta','approval','completed','failed','cancelled','timed_out','unknown','tool')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,sequence),
 FOREIGN KEY(tenant_id,req_id,job_id) REFERENCES agent_jobs(tenant_id,req_id,id));

CREATE TABLE agent_approvals (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,job_id uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 200),
 thread_id text NOT NULL CHECK(length(thread_id) BETWEEN 1 AND 200),turn_id text NOT NULL CHECK(length(turn_id) BETWEEN 1 AND 200),item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 200),
 scope_hash text NOT NULL CHECK(scope_hash ~ '^[a-f0-9]{64}$'),request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=65536),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','DENIED','EXPIRED')),
 expires_at timestamptz NOT NULL,decided_by uuid,decided_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,req_id,id),UNIQUE(tenant_id,req_id,job_id,id),UNIQUE(job_id,request_id),
 FOREIGN KEY(tenant_id,req_id,job_id) REFERENCES agent_jobs(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,decided_by) REFERENCES members(tenant_id,id),
 CHECK((state IN ('APPROVED','DENIED'))=(decided_by IS NOT NULL)),CHECK((state='PENDING')=(decided_at IS NULL)));

CREATE TABLE material_extractions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,material_version_id uuid NOT NULL,job_id uuid NOT NULL,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('READY','PARTIAL','NEEDS_VISION','FAILED')),
 parser_version text NOT NULL CHECK(length(parser_version) BETWEEN 1 AND 160),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,req_id,id),UNIQUE(job_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,material_version_id) REFERENCES material_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id,job_id) REFERENCES agent_jobs(tenant_id,req_id,id));
CREATE TABLE material_segments (
 tenant_id uuid NOT NULL,req_id uuid NOT NULL,extraction_id uuid NOT NULL,
 ordinal int NOT NULL CHECK(ordinal BETWEEN 1 AND 20000),location jsonb NOT NULL CHECK(jsonb_typeof(location)='object' AND octet_length(location::text)<=4096),
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 200000),hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(extraction_id,ordinal),FOREIGN KEY(tenant_id,req_id,extraction_id) REFERENCES material_extractions(tenant_id,req_id,id));

CREATE TABLE project_scans (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));

CREATE TABLE tool_executions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,job_id uuid NOT NULL,approval_id uuid NOT NULL,
 item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 200),
 command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN')),
 exit_code int,duration_ms int CHECK(duration_ms BETWEEN 0 AND 300000),
 evidence jsonb CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,req_id,id),UNIQUE(job_id,item_id),
 FOREIGN KEY(tenant_id,req_id,job_id) REFERENCES agent_jobs(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,job_id,approval_id) REFERENCES agent_approvals(tenant_id,req_id,job_id,id),
 CHECK(state<>'SUCCEEDED' OR (exit_code=0 AND evidence IS NOT NULL)));
CREATE TABLE runner_evidence (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,job_id uuid NOT NULL,execution_id uuid NOT NULL,
 baseline_id uuid NOT NULL,batch_id uuid NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 test_hash text NOT NULL CHECK(test_hash ~ '^[a-f0-9]{64}$'),report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
 results jsonb NOT NULL CHECK(jsonb_typeof(results)='array' AND jsonb_array_length(results) BETWEEN 1 AND 200 AND octet_length(results::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,req_id,id),UNIQUE(job_id),UNIQUE(batch_id),
 FOREIGN KEY(tenant_id,req_id,job_id) REFERENCES agent_jobs(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,execution_id) REFERENCES tool_executions(tenant_id,req_id,id),
 FOREIGN KEY(tenant_id,req_id,batch_id,baseline_id) REFERENCES test_batches(tenant_id,req_id,id,baseline_id));

ALTER TABLE test_batches DROP CONSTRAINT test_batches_source_check;
ALTER TABLE test_batches ADD CONSTRAINT test_batches_source_check CHECK(source IN ('USER_REPORTED','LOCAL_RUNNER'));
ALTER TABLE test_results DROP CONSTRAINT test_results_source_check;
ALTER TABLE test_results ADD CONSTRAINT test_results_source_check CHECK(source IN ('USER_REPORTED','LOCAL_RUNNER'));

CREATE FUNCTION agent_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AGENT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','result','error_code','owner_id','lease_until','dispatched_at','next_sequence','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','result','error_code','owner_id','lease_until','dispatched_at','next_sequence','updated_at'])
 THEN RAISE EXCEPTION 'AGENT_INPUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
 THEN RAISE EXCEPTION 'AGENT_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.next_sequence < OLD.next_sequence OR NEW.next_sequence > OLD.next_sequence+1
 THEN RAISE EXCEPTION 'AGENT_SEQUENCE_INVALID' USING ERRCODE='23514'; END IF;
 IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') AND (to_jsonb(NEW)-'next_sequence') IS DISTINCT FROM (to_jsonb(OLD)-'next_sequence')
 THEN RAISE EXCEPTION 'AGENT_TERMINAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.state<>OLD.state AND NOT (
   (OLD.state='QUEUED' AND NEW.state IN ('RUNNING','FAILED','CANCELLED')) OR
   (OLD.state='RUNNING' AND NEW.state IN ('QUEUED','WAITING_APPROVAL','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN')) OR
   (OLD.state='WAITING_APPROVAL' AND NEW.state IN ('RUNNING','FAILED','CANCELLED','TIMED_OUT','UNKNOWN')) OR
   (OLD.state='UNKNOWN' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')))
 THEN RAISE EXCEPTION 'AGENT_STATE_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.state='QUEUED' AND NEW.dispatched_at IS NOT NULL
 THEN RAISE EXCEPTION 'AGENT_REPLAY_FORBIDDEN' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER agent_jobs_guard BEFORE UPDATE OR DELETE ON agent_jobs FOR EACH ROW EXECUTE FUNCTION agent_job_guard();
CREATE TRIGGER agent_events_immutable BEFORE UPDATE OR DELETE ON agent_events FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER material_extractions_immutable BEFORE UPDATE OR DELETE ON material_extractions FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER material_segments_immutable BEFORE UPDATE OR DELETE ON material_segments FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER project_scans_immutable BEFORE UPDATE OR DELETE ON project_scans FOR EACH ROW EXECUTE FUNCTION verification_immutable();
CREATE TRIGGER runner_evidence_immutable BEFORE UPDATE OR DELETE ON runner_evidence FOR EACH ROW EXECUTE FUNCTION verification_immutable();

CREATE FUNCTION agent_extraction_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM material_versions v JOIN materials m ON m.tenant_id=v.tenant_id AND m.id=v.material_id
   WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.material_version_id AND m.req_id=NEW.req_id)
 THEN RAISE EXCEPTION 'EXTRACTION_SOURCE_OWNER_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER material_extraction_owner BEFORE INSERT ON material_extractions FOR EACH ROW EXECUTE FUNCTION agent_extraction_owner();
