-- =====================================================================
-- PFC 正式平台 · M1 数据库 Schema（PostgreSQL 14+）
-- 依据《12-正式平台服务端设计蓝图》第二节，与原型 localStorage 状态逐字段对应
-- 约定：所有表含 tenant_id（租户隔离）；主键 uuid 文本；时间戳 timestamptz
-- 执行：psql -f m1-schema.sql（可重复执行：先 DROP SCHEMA 演示库或建独立库）
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1) 租户与身份
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'internal',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  email       text,
  source      text NOT NULL DEFAULT 'sso',   -- sso / scim / dev
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  team_id     text NOT NULL DEFAULT 'default',
  role        text NOT NULL CHECK (role IN ('owner','executor','viewer')),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  role        text NOT NULL,
  action      text NOT NULL,          -- 如 run.control / release.approve / gov.configure
  allowed     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, role, action)
);

-- ---------------------------------------------------------------------
-- 2) 产品需求域（对应原型 reqs / versions / materials / questions / messages / caps/units）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  goal        text,
  scope       text,
  owner       text NOT NULL DEFAULT '陈立',
  stage       text NOT NULL DEFAULT 'idea'
              CHECK (stage IN ('idea','req','design','dev','test','accept','release','observe','closed')),
  project_id  uuid,                    -- 关联 projects（现有系统迭代）
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reqs_tenant_stage ON reqs(tenant_id, stage);

CREATE TABLE IF NOT EXISTS req_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  req_id       uuid NOT NULL REFERENCES reqs(id),
  stage        text NOT NULL,
  version      int  NOT NULL,
  content      jsonb NOT NULL DEFAULT '{}',
  confirmed_by text,
  confirmed_at timestamptz,
  stale        boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (req_id, stage, version)
);
CREATE INDEX IF NOT EXISTS idx_req_versions_req ON req_versions(req_id, stage);

CREATE TABLE IF NOT EXISTS materials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  req_id      uuid NOT NULL REFERENCES reqs(id),
  file_ref    text,                    -- 本地文件引用（路径 + sha256）
  name        text NOT NULL,
  content     text,
  cls         text NOT NULL DEFAULT '内部',
  type        text,
  allowed     boolean NOT NULL DEFAULT true,
  status      text NOT NULL DEFAULT '未纳入',   -- 未纳入 / 已纳入
  sha256      text,
  size        bigint DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materials_req ON materials(req_id);

CREATE TABLE IF NOT EXISTS questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  req_id      uuid NOT NULL REFERENCES reqs(id),
  q           text NOT NULL,
  answer      text,
  answered_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  req_id      uuid NOT NULL REFERENCES reqs(id),
  stage       text NOT NULL,
  turn_id     text,
  role        text NOT NULL,           -- user / assistant
  content     text,
  attachments jsonb NOT NULL DEFAULT '[]',
  refs        jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'ok',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_req_stage ON messages(req_id, stage, created_at);

CREATE TABLE IF NOT EXISTS caps_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  req_id      uuid NOT NULL REFERENCES reqs(id),
  cap_id      text NOT NULL,           -- CAP-01
  unit_id     text NOT NULL,           -- U01
  name        text,
  status      text NOT NULL DEFAULT '待实现' CHECK (status IN ('待实现','已实现','已完成')),
  owner       text DEFAULT '陈立',
  deps        jsonb NOT NULL DEFAULT '[]',
  UNIQUE (req_id, cap_id, unit_id)
);

-- ---------------------------------------------------------------------
-- 3) 执行域（对应原型 projects / bridges / leases / runs / 计划 / 质量门 / 回放 / 终端流）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  path        text NOT NULL,           -- 本地绝对路径（元数据，不存文件体）
  branch      text,
  tech        jsonb NOT NULL DEFAULT '[]',
  source      text NOT NULL DEFAULT 'existing' CHECK (source IN ('existing','new')),
  files       int DEFAULT 0,
  loaded_by   text,
  loaded_at   timestamptz
);

CREATE TABLE IF NOT EXISTS bridges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  device_name   text NOT NULL,
  status        text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
  last_seen     timestamptz,
  pair_code_hash text                    -- 一次性配对码哈希，验证后置空
);

CREATE TABLE IF NOT EXISTS leases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  bridge_id   uuid REFERENCES bridges(id),
  run_id      uuid,
  controller  text NOT NULL CHECK (controller IN ('web','agent')),
  state       text NOT NULL DEFAULT 'active' CHECK (state IN ('active','lost','revoked','none')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id)                       -- 同一 run 仅一个租约
);

CREATE TABLE IF NOT EXISTS runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  req_id      uuid NOT NULL REFERENCES reqs(id),
  project_id  uuid REFERENCES projects(id),
  status      text NOT NULL DEFAULT 'QUEUED'
              CHECK (status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_APPROVAL','SUCCEEDED','FAILED','CANCELLING','CANCELLED','UNKNOWN','VERIFYING')),
  step        int NOT NULL DEFAULT 0,
  pct         int NOT NULL DEFAULT 0,
  controller  text NOT NULL DEFAULT 'web',
  budget      bigint NOT NULL DEFAULT 8000,
  spent       bigint NOT NULL DEFAULT 0,
  exit_code   int,
  scope       text,
  scope_id    text,
  operation   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_req ON runs(req_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS run_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  run_id         uuid NOT NULL REFERENCES runs(id),
  plan           text NOT NULL,        -- 执行计划拆解
  approved_by    text,
  approved_at    timestamptz,
  rejected_reason text                  -- 拒绝原因（拒绝留痕）
);

CREATE TABLE IF NOT EXISTS quality_gates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  run_id        uuid NOT NULL REFERENCES runs(id),
  gate_id       text NOT NULL,          -- lint / unit / coverage / build / security
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pass','fail')),
  evidence_ref  text,                   -- CI 回填证据
  ran_at        timestamptz,
  UNIQUE (run_id, gate_id)
);

CREATE TABLE IF NOT EXISTS replays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  run_id      uuid NOT NULL REFERENCES runs(id),
  step_no     int NOT NULL,
  label       text,
  snapshot_ref text,                    -- 快照（文件/命令摘要）
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_no)
);

CREATE TABLE IF NOT EXISTS run_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  run_id      uuid NOT NULL REFERENCES runs(id),
  cls         text NOT NULL DEFAULT 'info',   -- info / warn / error
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_lines_run ON run_lines(run_id, created_at);

-- ---------------------------------------------------------------------
-- 4) 治理域（对应原型 caps / bindings / audit / budget / policies）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('Skill','MCP','ACP','终端工具')),
  protocol    text NOT NULL,            -- 原生 Skill / MCP / ACP / 终端
  endpoint    text,                     -- 连接地址 / 命令
  src         text,
  ver         text,
  desc        text,
  pending     boolean NOT NULL DEFAULT true,   -- 待复核
  perm        text NOT NULL DEFAULT '任务范围内执行',
  ico         text DEFAULT 'cpu',
  color       text DEFAULT '#00A0E9',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, ver)
);

CREATE TABLE IF NOT EXISTS cap_bindings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  stage       text NOT NULL,
  cap_id      uuid NOT NULL REFERENCES caps(id),
  UNIQUE (tenant_id, stage, cap_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  actor       text NOT NULL,
  req_id      text,
  action      text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS budgets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  period      text NOT NULL,            -- 2026-09
  quota       bigint NOT NULL DEFAULT 0,
  used        bigint NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS team_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  parallel_limit int NOT NULL DEFAULT 3,
  network_policy text NOT NULL DEFAULT 'closed',   -- closed / whitelist
  scope_rules    jsonb NOT NULL DEFAULT '[]'        -- 范围白名单
);

-- ---------------------------------------------------------------------
-- 5) 知识域（对应原型 knowledge / knowledgeRefs）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  title       text NOT NULL,
  type        text NOT NULL CHECK (type IN ('复盘结论','组件规范','接口契约','踩坑记录','Playbook')),
  content     text,
  source_req  text,
  tags        jsonb NOT NULL DEFAULT '[]',
  embedding   vector(768),              -- 需 pgvector；可延迟启用
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge(tenant_id);

CREATE TABLE IF NOT EXISTS knowledge_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  req_id       uuid NOT NULL REFERENCES reqs(id),
  knowledge_id uuid NOT NULL REFERENCES knowledge(id),
  matched_by   text NOT NULL DEFAULT 'keyword',   -- keyword / vector / manual
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (req_id, knowledge_id)
);

-- ---------------------------------------------------------------------
-- 6) 发布与通知域（对应原型 releases / release_cicd / notices）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS releases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  req_id       uuid NOT NULL REFERENCES reqs(id),
  target       text NOT NULL DEFAULT '演示环境',
  scope        text,
  stamp        text,                    -- 版本基线
  rollback     text,
  hours        int NOT NULL DEFAULT 24,
  status       text NOT NULL DEFAULT 'DRAFT'
               CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','STALE','SUCCEEDED','FAILED')),
  expires_at   timestamptz,
  snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS release_cicd (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  release_id  uuid NOT NULL REFERENCES releases(id),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pass','fail')),
  steps_json  jsonb NOT NULL DEFAULT '[]',     -- 构建/单测/部署/冒烟
  ran_at      timestamptz
);

CREATE TABLE IF NOT EXISTS notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid REFERENCES users(id),
  kind        text NOT NULL DEFAULT 'info' CHECK (kind IN ('info','warn')),
  title       text NOT NULL,
  req_id      text,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notices_unread ON notices(tenant_id, user_id, read, created_at DESC);

-- 说明：vector 类型依赖 pgvector 扩展；M1 可先不用 embedding，用 keyword 检索
-- （对齐原型自动检索），M3 知识库向量阶段再启用。
