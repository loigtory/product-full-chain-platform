'use strict';
// 64 号：设计阶段产物快照服务
// EXEC design 作业完成后，从工作区约定目录收集设计产物并登记：
//   design/design.md -> design（技术方案） | design/sequence.mmd -> sequence（时序图）
//   design/flow.mmd -> flow（流程图）      | design/prototype.html -> prototype（可交互原型）
// 同一 req+kind 只保留最新快照（覆盖更新，旧版本在工作区/git 可追溯）。
const { createHash, randomUUID } = require('node:crypto');
const access = require('../access'),
  runtime = require('../runtime');
const { allocateIdentifier } = require('../persistence/identifiers');

const KINDS = ['design', 'sequence', 'flow', 'prototype'];
const MAX_CONTENT_BYTES = 1048576;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sanitize(input) {
  if (!input || typeof input !== 'object') fail('DESIGN_ARTIFACT_INVALID', 400);
  const kind = String(input.kind || '');
  if (!KINDS.includes(kind)) fail('DESIGN_ARTIFACT_KIND_INVALID', 400);
  const name = String(input.name || '').trim();
  if (name.length < 1 || name.length > 200) fail('DESIGN_ARTIFACT_NAME_INVALID', 400);
  const content = String(input.content || '');
  if (content.length < 1 || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES)
    fail('DESIGN_ARTIFACT_CONTENT_INVALID', 400);
  const source =
    input.source && typeof input.source === 'object' && !Array.isArray(input.source)
      ? input.source
      : {};
  return { kind, name, content, source };
}

async function withReq(db, ctx, reqPublicId, work) {
  const rows = (
    await db.pool.query(
      'SELECT * FROM "' + db.schema + '".reqs WHERE tenant_id=$1 AND public_id=$2',
      [ctx.tenantId, reqPublicId],
    )
  ).rows;
  if (!rows[0]) fail('NOT_FOUND', 404);
  return work(rows[0]);
}

// 登记（EXEC 作业完成自动调用 / 亦可用于人工补录）。upsert 语义：按 tenant+req+kind 覆盖。
async function register(db, ctx, reqPublicId, input) {
  const { kind, name, content, source } = sanitize(input);
  const fingerprint = sha256(content);
  return withReq(db, ctx, reqPublicId, async (req) => {
    const id = randomUUID();
    const publicId = 'DA-' + id.slice(0, 8) + '-' + kind;
    await db.pool.query(
      `INSERT INTO "${db.schema}".design_artifacts
         (id, tenant_id, req_id, public_id, kind, name, content, fingerprint, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, req_id, kind)
       DO UPDATE SET public_id=EXCLUDED.public_id, name=EXCLUDED.name, content=EXCLUDED.content,
         fingerprint=EXCLUDED.fingerprint, source=EXCLUDED.source, created_by=EXCLUDED.created_by,
         created_at=now()`,
      [id, req.tenant_id, req.id, publicId, kind, name, content, fingerprint, JSON.stringify(source), ctx.memberId],
    );
    return { publicId, kind, name, fingerprint };
  });
}

// 读取某需求的全部设计产物（kind -> {name, content, fingerprint, updatedAt, source}）
async function listForReq(db, ctx, reqPublicId) {
  return withReq(db, ctx, reqPublicId, async (req) => {
    const rows = (
      await db.pool.query(
        'SELECT kind,name,content,fingerprint,source,created_at FROM "' +
          db.schema +
          '".design_artifacts WHERE tenant_id=$1 AND req_id=$2 ORDER BY kind',
        [ctx.tenantId, req.id],
      )
    ).rows;
    const out = {};
    for (const r of rows) {
      out[r.kind] = {
        name: r.name,
        content: r.content,
        fingerprint: r.fingerprint,
        source: r.source,
        updatedAt: r.created_at,
      };
    }
    return out;
  });
}

// 收集 EXEC 工作区产物并登记（worker 调用；只登记存在的约定文件）
async function collectFromWorkspace(db, ctx, reqPublicId, workspace, jobId) {
  const fs = require('node:fs'),
    path = require('node:path');
  const plan = [
    ['design', 'design.md', '方案设计'],
    ['sequence', 'sequence.mmd', '时序图'],
    ['flow', 'flow.mmd', '流程图'],
    ['prototype', 'prototype.html', '可交互原型'],
  ];
  const registered = [];
  for (const [kind, file, label] of plan) {
    const p = path.join(workspace, 'design', file);
    let content;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch (e) {
      continue; // 约定文件不存在则跳过（不是错误）
    }
    if (!content.trim()) continue;
    const r = await register(db, ctx, reqPublicId, {
      kind,
      name: label,
      content,
      source: { origin: 'exec-workspace', jobId, file: 'design/' + file },
    });
    registered.push(r);
  }
  return registered;
}

module.exports = { KINDS, register, listForReq, collectFromWorkspace };
