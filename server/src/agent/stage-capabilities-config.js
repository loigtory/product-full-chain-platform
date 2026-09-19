'use strict';
// 55 号：阶段能力配置中心（热插拔 skill/tool/mcp）。
// 配置即数据：页面操作 → 本服务 → stage_capabilities 表 → worker 每次新作业按阶段读取装载。
// 读：登录成员可读；写（upsert/remove/setEnabled）：owner 专属（影响全平台阶段作业）。
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../persistence/transaction');

const STAGES = ['idea', 'req', 'design', 'dev', 'test', 'accept', 'release', 'observe'];
const KINDS = ['skill', 'tool', 'mcp', 'model'];
const SOURCES = ['local', 'github', 'company'];

const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};

function sanitize(input) {
  if (!input || typeof input !== 'object') fail('CAPABILITY_INVALID', 400);
  const stage = String(input.stage || '');
  const kind = String(input.kind || '');
  const name = String(input.name || '').trim();
  if (!STAGES.includes(stage)) fail('STAGE_INVALID', 400);
  if (!KINDS.includes(kind)) fail('KIND_INVALID', 400);
  if (name.length < 1 || name.length > 200) fail('CAPABILITY_NAME_INVALID', 400);
  const source = String(input.source || 'local');
  if (!SOURCES.includes(source)) fail('SOURCE_INVALID', 400);
  // 010 号：slug=装载名（worker 按 ~/.codex/skills 目录名匹配）；显示名 name 与装载名分离
  const slug = input.slug == null || input.slug === '' ? null : String(input.slug).trim();
  if (slug !== null && (slug.length < 1 || slug.length > 200)) fail('SLUG_INVALID', 400);
  const sourceUrl = input.sourceUrl == null ? null : String(input.sourceUrl).trim();
  if (sourceUrl !== null && (sourceUrl.length < 1 || sourceUrl.length > 1000))
    fail('SOURCE_URL_INVALID', 400);
  const description =
    input.description == null ? null : String(input.description).trim().slice(0, 2000);
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const priority = Number.isSafeInteger(input.priority) ? input.priority : 100;
  if (priority < 1 || priority > 999) fail('PRIORITY_INVALID', 400);
  return { stage, kind, name, slug, source, sourceUrl, description, enabled, priority };
}

async function list(db, ctx) {
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stageCapability.read',
    );
    const rows = (
      await client.query(
        `SELECT stage,kind,name,slug,source,source_url,description,enabled,priority,updated_at
           FROM "${db.schema}".stage_capabilities
          WHERE tenant_id=$1 ORDER BY stage, kind, priority, name`,
        [ctx.tenantId],
      )
    ).rows;
    return rows;
  });
}

async function forStage(db, ctx, stage) {
  if (!STAGES.includes(String(stage || ''))) fail('STAGE_INVALID', 400);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stageCapability.read',
    );
    const rows = (
      await client.query(
        `SELECT stage,kind,name,slug,source,source_url,description,enabled,priority,updated_at
           FROM "${db.schema}".stage_capabilities
          WHERE tenant_id=$1 AND stage=$2 ORDER BY kind, priority, name`,
        [ctx.tenantId, stage],
      )
    ).rows;
    return rows;
  });
}

// 56 号：EXEC 作业装载用——某阶段启用的 tool/mcp 名称列表（host 工具热插拔候选）
async function enabledHostToolsForStage(db, tenantId, stage) {
  const rows = (
    await db.pool.query(
      `SELECT name FROM "${db.schema}".stage_capabilities
        WHERE tenant_id=$1 AND stage=$2 AND kind='tool' AND enabled=true
        ORDER BY priority, name`,
      [tenantId, stage],
    )
  ).rows;
  return rows.map((r) => r.name);
}

// worker 装载用：某阶段启用的 skill 名称列表（轻量读，不依赖成员上下文）。
// 010 号：优先返回 slug（真实 codex 目录名），slug 为空时回退 name（兼容旧数据/同名条目）。
async function enabledSkillsForStage(db, tenantId, stage) {
  const rows = (
    await db.pool.query(
      `SELECT COALESCE(slug, name) AS name FROM "${db.schema}".stage_capabilities
        WHERE tenant_id=$1 AND stage=$2 AND kind='skill' AND enabled=true
        ORDER BY priority, name`,
      [tenantId, stage],
    )
  ).rows;
  return rows.map((r) => r.name);
}

// 70 号：按阶段绑定的 LLM 模型名（传给 codex -c model=xxx）。
// 显示名 → codex model 名映射（caps 表 name 是友好显示名，codex 要小写横杠）。
const MODEL_NAME_MAP = {
  'GPT-6 Astra': 'gpt-6-astra',
  'GPT-5': 'gpt-5',
  'Claude Sonnet 4': 'claude-sonnet-4',
  'DeepSeek V3.5': 'deepseek-v3.5',
  'Qwen Max': 'qwen-max',
};
async function enabledModelForStage(db, tenantId, stage) {
  const rows = (
    await db.pool.query(
      `SELECT name FROM "${db.schema}".stage_capabilities
        WHERE tenant_id=$1 AND stage=$2 AND kind='model' AND enabled=true
        ORDER BY priority, name LIMIT 1`,
      [tenantId, stage],
    )
  ).rows;
  if (!rows.length) return null;
  const displayName = rows[0].name;
  return MODEL_NAME_MAP[displayName] || displayName;
}

async function upsert(db, ctx, input) {
  const v = sanitize(input);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stageCapability.write',
    );
    if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
    await client.query(
      `INSERT INTO "${db.schema}".stage_capabilities
         (id,tenant_id,stage,kind,name,slug,source,source_url,description,enabled,priority,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id,stage,kind,name) DO UPDATE SET
         slug=EXCLUDED.slug,source=EXCLUDED.source,source_url=EXCLUDED.source_url,
         description=EXCLUDED.description,enabled=EXCLUDED.enabled,
         priority=EXCLUDED.priority,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        randomUUID(),
        ctx.tenantId,
        v.stage,
        v.kind,
        v.name,
        v.slug,
        v.source,
        v.sourceUrl,
        v.description,
        v.enabled,
        v.priority,
        ctx.memberId,
      ],
    );
    return { stage: v.stage, kind: v.kind, name: v.name, slug: v.slug, enabled: v.enabled, priority: v.priority };
  });
}

async function remove(db, ctx, stage, kind, name) {
  if (!STAGES.includes(String(stage || ''))) fail('STAGE_INVALID', 400);
  if (!KINDS.includes(String(kind || ''))) fail('KIND_INVALID', 400);
  const clean = String(name || '').trim();
  if (!clean) fail('CAPABILITY_NAME_INVALID', 400);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stageCapability.write',
    );
    if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
    const result = await client.query(
      `DELETE FROM "${db.schema}".stage_capabilities
        WHERE tenant_id=$1 AND stage=$2 AND kind=$3 AND name=$4`,
      [ctx.tenantId, stage, kind, clean],
    );
    return { removed: result.rowCount > 0 };
  });
}

async function setEnabled(db, ctx, stage, kind, name, enabled) {
  if (!STAGES.includes(String(stage || ''))) fail('STAGE_INVALID', 400);
  if (!KINDS.includes(String(kind || ''))) fail('KIND_INVALID', 400);
  const clean = String(name || '').trim();
  if (!clean) fail('CAPABILITY_NAME_INVALID', 400);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stageCapability.write',
    );
    if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
    const result = await client.query(
      `UPDATE "${db.schema}".stage_capabilities
          SET enabled=$5, updated_by=$6, updated_at=now()
        WHERE tenant_id=$1 AND stage=$2 AND kind=$3 AND name=$4`,
      [ctx.tenantId, stage, kind, clean, Boolean(enabled), ctx.memberId],
    );
    return { stage, kind, name: clean, enabled: Boolean(enabled), updated: result.rowCount > 0 };
  });
}

module.exports = { STAGES, KINDS, SOURCES, list, forStage, enabledSkillsForStage, enabledHostToolsForStage, enabledModelForStage, upsert, remove, setEnabled };
