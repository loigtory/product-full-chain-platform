-- Express workbench domains. Explicit migration only; no application startup DDL.
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references'));
ALTER TABLE reqs ADD COLUMN revision int NOT NULL DEFAULT 0 CHECK(revision>=0),
 ADD COLUMN material_revision int NOT NULL DEFAULT 0 CHECK(material_revision>=0), ADD COLUMN closed_at timestamptz;
ALTER TABLE req_versions ADD CONSTRAINT req_versions_tenant_id_unique UNIQUE(tenant_id,id);
ALTER TABLE req_versions ADD COLUMN base_version_id uuid,
 ADD COLUMN review_state text NOT NULL DEFAULT '待评审',
 ADD FOREIGN KEY(tenant_id,base_version_id) REFERENCES req_versions(tenant_id,id);
CREATE TABLE req_version_reviews (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,version_id uuid NOT NULL,public_id text NOT NULL,
 actor text NOT NULL,result text NOT NULL CHECK(result IN ('通过','需修改','意见')),comment text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,version_id) REFERENCES req_versions(tenant_id,id));
CREATE TABLE questions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,q text NOT NULL,
 answer text NOT NULL DEFAULT '',answered_by text,revision int NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id));
CREATE TABLE file_objects (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 size bigint NOT NULL CHECK(size>=0 AND size<=10485760),file_ref text NOT NULL,status text NOT NULL CHECK(status='READY'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,hash),UNIQUE(tenant_id,id),UNIQUE(tenant_id,public_id));
CREATE TABLE materials (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,name text NOT NULL,
 classification text NOT NULL CHECK(classification IN ('公开','内部','受限')),allowed boolean NOT NULL,
 usage text NOT NULL CHECK(usage IN ('material','attachment')),status text NOT NULL CHECK(status IN ('已纳入','只登记','待确认影响')),
 version int NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(classification<>'受限' OR NOT allowed),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id));
CREATE TABLE material_versions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,material_id uuid NOT NULL,public_id text NOT NULL,version int NOT NULL CHECK(version>0),
 content text NOT NULL DEFAULT '',file_id uuid,mime_type text NOT NULL DEFAULT 'text/plain',name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),UNIQUE(material_id,version),
 FOREIGN KEY(tenant_id,material_id) REFERENCES materials(tenant_id,id),FOREIGN KEY(tenant_id,file_id) REFERENCES file_objects(tenant_id,id));
CREATE TABLE messages (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,turn_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('user','ai')),stage text NOT NULL CHECK(stage IN ('idea','req','design','dev')),
 content text NOT NULL,revision int NOT NULL DEFAULT 0 CHECK(revision>=0),status text NOT NULL CHECK(status IN ('ok','generating','stopped','interrupted')),
 reply_to uuid,parent_message_id uuid,retry_message_id uuid,source text NOT NULL DEFAULT 'simulation',
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,reply_to) REFERENCES messages(tenant_id,id),FOREIGN KEY(tenant_id,parent_message_id) REFERENCES messages(tenant_id,id),
 FOREIGN KEY(tenant_id,retry_message_id) REFERENCES messages(tenant_id,id));
CREATE TABLE message_references (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,message_id uuid NOT NULL,public_id text NOT NULL,
 material_version_id uuid,req_version_id uuid,
 CHECK((material_version_id IS NOT NULL)::int+(req_version_id IS NOT NULL)::int=1),
 UNIQUE(tenant_id,public_id),FOREIGN KEY(tenant_id,message_id) REFERENCES messages(tenant_id,id),
 FOREIGN KEY(tenant_id,material_version_id) REFERENCES material_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,req_version_id) REFERENCES req_versions(tenant_id,id));
CREATE TABLE runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,parent_id uuid,
 status text NOT NULL CHECK(status IN ('WAITING_APPROVAL','RUNNING','CANCELLING','CANCELLED','UNKNOWN','SUCCEEDED','FAILED')),
 revision int NOT NULL DEFAULT 0 CHECK(revision>=0),execution_mode text NOT NULL DEFAULT 'simulation',bridge_id text,bridge_name text,
 dispatch_id uuid,dispatch_state text CHECK(dispatch_state IN ('dispatching','sent','unknown')),last_bridge_seq int NOT NULL DEFAULT 0,
 step int NOT NULL DEFAULT 0,pct int NOT NULL DEFAULT 0 CHECK(pct BETWEEN 0 AND 100),exit_code int,started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,parent_id) REFERENCES runs(tenant_id,id));
CREATE TABLE run_plans (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,run_id uuid NOT NULL,public_id text NOT NULL,plan text NOT NULL,
 baseline text NOT NULL CHECK(length(baseline)=64),approved_by text,approved_at timestamptz,rejected_reason text,
 UNIQUE(tenant_id,public_id),UNIQUE(run_id),FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id));
CREATE TABLE run_lines (
 tenant_id uuid NOT NULL,run_id uuid NOT NULL,seq int NOT NULL CHECK(seq>0),event_id text NOT NULL,
 cls text NOT NULL,text text NOT NULL CHECK(length(text)<=16000),source text NOT NULL DEFAULT 'simulation',
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,seq),UNIQUE(run_id,event_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id));
CREATE TABLE replays (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,run_id uuid NOT NULL,public_id text NOT NULL,step_no int NOT NULL,
 label text NOT NULL,snapshot_ref text,source text NOT NULL DEFAULT 'simulation',
 UNIQUE(tenant_id,public_id),UNIQUE(run_id,step_no),FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id));
CREATE TABLE quality_gates (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,run_id uuid NOT NULL,public_id text NOT NULL,gate_id text NOT NULL,
 name text NOT NULL,status text NOT NULL CHECK(status IN ('pass','fail','pending')),evidence_ref text,source text NOT NULL DEFAULT 'simulation',
 UNIQUE(tenant_id,public_id),UNIQUE(run_id,gate_id),FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id));
CREATE TABLE leases (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,run_id uuid NOT NULL,public_id text NOT NULL,actor text NOT NULL,
 controller text NOT NULL,device_id text,revision int NOT NULL DEFAULT 0,state text NOT NULL CHECK(state IN ('active','lost')),
 acquired_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(run_id),FOREIGN KEY(tenant_id,run_id) REFERENCES runs(tenant_id,id));
CREATE TABLE notices (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,req_id uuid NOT NULL,public_id text NOT NULL,text text NOT NULL,level text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id));
CREATE TABLE notice_reads (
 tenant_id uuid NOT NULL,notice_id uuid NOT NULL,actor text NOT NULL,read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notice_id,actor),FOREIGN KEY(tenant_id,notice_id) REFERENCES notices(tenant_id,id));
CREATE TABLE command_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id),actor text NOT NULL,operation text NOT NULL,command_id text NOT NULL CHECK(length(command_id) BETWEEN 1 AND 160),
 fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor,operation,command_id));
CREATE TABLE domain_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,seq bigint GENERATED ALWAYS AS IDENTITY,
 aggregate_id text NOT NULL,revision int NOT NULL,type text NOT NULL,payload jsonb NOT NULL CHECK(octet_length(payload::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,public_id),UNIQUE(seq));
CREATE INDEX idx_messages_req_time ON messages(tenant_id,req_id,created_at,id);
CREATE INDEX idx_materials_req ON materials(tenant_id,req_id);
CREATE INDEX idx_runs_req ON runs(tenant_id,req_id,created_at);
CREATE INDEX idx_events_tenant_seq ON domain_events(tenant_id,seq);
