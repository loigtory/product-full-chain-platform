-- Stage capability configuration: hot-swappable skill/tool/mcp bindings per stage.
-- 配置即数据（非代码）：页面操作 → 配置表 → worker 每次新作业按阶段读取装载。
-- 与 008 冻结计划不同，本表允许自由增删改（热插拔是设计意图，不设 immutable 触发器）；
-- UNIQUE(tenant_id,stage,kind,name) 保证同一阶段同类同名配置唯一（重复提交幂等）。
CREATE TABLE stage_capabilities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN ('idea','req','design','dev','test','accept','release','observe')),
  kind text NOT NULL CHECK(kind IN ('skill','tool','mcp')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  source text NOT NULL DEFAULT 'local' CHECK(source IN ('local','github','company')),
  source_url text CHECK(source_url IS NULL OR length(source_url) BETWEEN 1 AND 1000),
  description text CHECK(description IS NULL OR length(description) <= 2000),
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 999),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, stage, kind, name),
  FOREIGN KEY(tenant_id, updated_by) REFERENCES members(tenant_id, id)
);

CREATE INDEX stage_capabilities_scope_idx
  ON stage_capabilities(tenant_id, stage, kind, enabled, priority);
