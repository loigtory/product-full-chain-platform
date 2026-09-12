-- M2c-1 isolated storage baseline. Run only through migrations.js in the authorized disposable schema.
-- No extensions, roles, database-wide changes or application-schema migration.
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  plan text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE id_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity text NOT NULL CHECK (entity IN ('reqs','req_versions','audit_logs')),
  value bigint NOT NULL CHECK(value > 0),
  PRIMARY KEY(tenant_id,entity)
);
CREATE TABLE reqs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  public_id text NOT NULL,
  name text NOT NULL CHECK(length(btrim(name)) > 0),
  goal text,
  scope text,
  owner text NOT NULL,
  stage text NOT NULL DEFAULT 'idea' CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,public_id),
  UNIQUE(tenant_id,id)
);
CREATE TABLE req_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  req_id uuid NOT NULL,
  public_id text NOT NULL,
  stage text NOT NULL CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe','closed')),
  version int NOT NULL CHECK(version > 0),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
  confirmed_by text,
  confirmed_at timestamptz,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
  UNIQUE(tenant_id,public_id),
  UNIQUE(req_id,stage,version)
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  req_id uuid NOT NULL,
  public_id text NOT NULL,
  actor text NOT NULL CHECK(length(btrim(actor)) > 0),
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
  UNIQUE(tenant_id,public_id)
);
CREATE INDEX idx_audit_req_time ON audit_logs(tenant_id,req_id,created_at);
