-- Governance for the explicitly authorized Express workbench schema. No startup DDL.
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge'));
CREATE TABLE members (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 role text NOT NULL CHECK(role IN ('owner','executor','viewer')),active boolean NOT NULL DEFAULT true,
 revision int NOT NULL DEFAULT 0 CHECK(revision>=0),created_at timestamptz NOT NULL DEFAULT now(),disabled_at timestamptz,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,name),UNIQUE(tenant_id,public_id),CHECK(active=(disabled_at IS NULL)));
CREATE TABLE caps (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),type text NOT NULL CHECK(type IN ('Skill','MCP','ACP','终端工具')),
 protocol text NOT NULL,endpoint text NOT NULL CHECK(length(endpoint)<=2048),src text NOT NULL CHECK(length(src)<=160),
 ver text NOT NULL CHECK(length(btrim(ver)) BETWEEN 1 AND 100),description text NOT NULL CHECK(length(description)<=4000),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),reviewed_by uuid,reviewed_at timestamptz,
 enabled boolean NOT NULL DEFAULT false,revision int NOT NULL DEFAULT 0 CHECK(revision>=0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,public_id),UNIQUE(tenant_id,name,ver),
 FOREIGN KEY(tenant_id,reviewed_by) REFERENCES members(tenant_id,id),CHECK(NOT enabled OR reviewed_at IS NOT NULL),
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)));
CREATE TABLE binding_sets (
 tenant_id uuid NOT NULL REFERENCES tenants(id),stage text NOT NULL CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe')),
 revision int NOT NULL DEFAULT 0 CHECK(revision>=0),PRIMARY KEY(tenant_id,stage));
CREATE TABLE cap_bindings (
 tenant_id uuid NOT NULL,stage text NOT NULL,cap_id uuid NOT NULL,PRIMARY KEY(tenant_id,stage,cap_id),
 FOREIGN KEY(tenant_id,stage) REFERENCES binding_sets(tenant_id,stage),FOREIGN KEY(tenant_id,cap_id) REFERENCES caps(tenant_id,id));
CREATE TABLE req_cap_overrides (
 tenant_id uuid NOT NULL,req_id uuid NOT NULL,stage text NOT NULL CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe')),
 cap_id uuid NOT NULL,enabled boolean NOT NULL,PRIMARY KEY(tenant_id,req_id,stage,cap_id),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),FOREIGN KEY(tenant_id,cap_id) REFERENCES caps(tenant_id,id));
CREATE TABLE projects (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),path text NOT NULL CHECK(length(path) BETWEEN 1 AND 2048),
 repo text NOT NULL CHECK(length(repo)<=2048),branch text NOT NULL CHECK(length(branch)<=160),
 tech jsonb NOT NULL CHECK(jsonb_typeof(tech)='array' AND jsonb_array_length(tech)<=20),
 source text NOT NULL CHECK(length(source)<=40),revision int NOT NULL DEFAULT 0 CHECK(revision>=0),
 loaded_by uuid NOT NULL,loaded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,public_id),FOREIGN KEY(tenant_id,loaded_by) REFERENCES members(tenant_id,id));
ALTER TABLE reqs ADD COLUMN project_id uuid,ADD FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id);
CREATE TABLE knowledge (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),public_id text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),type text NOT NULL,
 content text NOT NULL CHECK(length(content)<=32000),tags jsonb NOT NULL CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=20),
 version int NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,public_id),FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id));
CREATE TABLE knowledge_links (
 tenant_id uuid NOT NULL,req_id uuid NOT NULL,knowledge_id uuid NOT NULL,version int NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=16000),
 PRIMARY KEY(tenant_id,req_id,knowledge_id),FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,knowledge_id) REFERENCES knowledge(tenant_id,id));
CREATE TABLE budget_accounts (
 tenant_id uuid NOT NULL REFERENCES tenants(id),period text NOT NULL CHECK(period ~ '^[0-9]{4}-[0-9]{2}$'),
 quota bigint NOT NULL CHECK(quota>=0),used bigint NOT NULL CHECK(used>=0 AND used<=quota),source text NOT NULL,
 revision int NOT NULL DEFAULT 0 CHECK(revision>=0),PRIMARY KEY(tenant_id,period));
ALTER TABLE run_plans ADD COLUMN snapshot_version int CHECK(snapshot_version=1),ADD COLUMN context_snapshot jsonb,
 ADD COLUMN context_fingerprint text CHECK(context_fingerprint ~ '^[a-f0-9]{64}$'),
 ADD COLUMN approved_member_id uuid,ADD COLUMN approved_role text CHECK(approved_role IN ('owner','executor')),
 ADD COLUMN approved_context_fingerprint text CHECK(approved_context_fingerprint ~ '^[a-f0-9]{64}$'),
 ADD FOREIGN KEY(tenant_id,approved_member_id) REFERENCES members(tenant_id,id),
 ADD CHECK((snapshot_version IS NULL AND context_snapshot IS NULL AND context_fingerprint IS NULL) OR
 (snapshot_version=1 AND jsonb_typeof(context_snapshot)='object' AND octet_length(context_snapshot::text)<=524288 AND context_fingerprint IS NOT NULL));
ALTER TABLE audit_logs ALTER COLUMN req_id DROP NOT NULL;
ALTER TABLE audit_logs ADD COLUMN entity_type text NOT NULL DEFAULT 'requirement',ADD COLUMN entity_id text;
CREATE INDEX idx_members_tenant_active ON members(tenant_id,active,role);
CREATE INDEX idx_caps_tenant_time ON caps(tenant_id,created_at,id);
CREATE INDEX idx_projects_tenant_time ON projects(tenant_id,loaded_at,id);
CREATE INDEX idx_knowledge_tenant_type_time ON knowledge(tenant_id,type,created_at,id);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id,created_at,id);
