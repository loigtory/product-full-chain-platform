-- 64 号：设计阶段产物（方案设计文档 / 时序图 / 流程图 / 可交互原型）
-- design_artifacts 为"当前设计快照"：EXEC design 作业完成后，从工作区约定目录收集
--   design/design.md        -> kind=design    （技术方案：架构/数据/接口/风险）
--   design/sequence.mmd     -> kind=sequence  （时序图，mermaid）
--   design/flow.mmd         -> kind=flow      （流程图，mermaid）
--   design/prototype.html   -> kind=prototype （可交互原型，自包含 HTML）
-- 同一 req+kind 只保留最新快照（旧版本文档与工作区文件可追溯），content<=1MB。
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge',
 'artifact_versions','artifact_groups','artifact_group_sources','artifact_proposals','artifact_confirmations','artifact_impacts','design_artifacts'));
CREATE TABLE design_artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  req_id uuid NOT NULL,
  public_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('design','sequence','flow','prototype')),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 200),
  content text NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 1048576),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,public_id),
  UNIQUE(tenant_id,req_id,id),
  UNIQUE(tenant_id,req_id,kind),
  FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id)
);
CREATE INDEX idx_design_artifacts_req ON design_artifacts(tenant_id,req_id,kind);
