'use strict';
const access = require('../access'),
  requirements = require('../persistence/requirements'),
  runs = require('../persistence/runs'),
  members = require('../persistence/members');
const { fingerprint } = require('../persistence/commands');
const LIMIT = 512 * 1024;
function bounded(snapshot) {
  if (Buffer.byteLength(JSON.stringify(snapshot)) > LIMIT)
    access.fail(
      'CONTEXT_LIMIT_EXCEEDED',
      409,
      '上下文超过512 KiB，请缩小引用范围',
    );
  return snapshot;
}
async function capture(client, db, ctx, req) {
  const versions = await requirements.versions(client, db, ctx, req.id),
    artifacts = [];
  for (const stage of ['idea', 'req', 'design']) {
    const v = versions
      .filter((v) => v.stage === stage)
      .sort((a, b) => b.version - a.version)[0];
    if (!v?.confirmed_at || v.stale)
      access.fail(
        'STAGE_BLOCKED',
        409,
        '计划需要最新且已确认的想法、需求和设计版本',
      );
    artifacts.push({
      id: v.public_id,
      stage: v.stage,
      version: v.version,
      fingerprint: fingerprint(v.content),
    });
  }
  const sourceMaterials = await require('../persistence/materials').list(
    client,
    db,
    ctx,
    req.id,
  );
  if (sourceMaterials.length > 100)
    access.fail('CONTEXT_LIMIT_EXCEEDED', 409, '材料超过100项，请缩小引用范围');
  const project = req.project_id
    ? require('./project-service').dto(
        await require('./project-service').required(
          client,
          db,
          ctx,
          req.project_id,
        ),
      )
    : null;
  const caps = await require('./capability-service').context(
    client,
    db,
    ctx,
    req,
  );
  const knowledgeRefs = await require('../persistence/knowledge').refs(
    client,
    db,
    ctx,
    req.id,
  );
  if (knowledgeRefs.length > 3) access.fail('CONTEXT_LIMIT_EXCEEDED', 409);
  const snapshot = {
    snapshotVersion: 1,
    requirement: {
      id: req.public_id,
      stage: req.stage,
      reqRevision: req.revision,
      materialRevision: req.material_revision,
    },
    artifacts,
    materials: sourceMaterials
      .map((m) => ({
        id: m.public_id,
        name: m.name,
        version: m.version,
        hash: m.hash || fingerprint(m.content),
        allowed: m.allowed,
        usage: m.usage,
        status: m.status,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    project,
    capabilities: {
      stage: req.stage,
      bindingRevision: caps.bindingRevision,
      overrides: caps.overrides,
      effectiveCaps: caps.effectiveCaps.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        protocol: c.protocol,
        ver: c.ver,
        endpoint: c.endpoint,
        src: c.src,
        desc: c.desc,
        fingerprint: c.fingerprint,
      })),
    },
    knowledgeRefs,
    source: 'server-domain-snapshot',
    createdAt: new Date().toISOString(),
  };
  snapshot.fingerprint = fingerprint(snapshot);
  bounded(snapshot);
  // PostgreSQL jsonb text includes separators; validate that actual representation too.
  const size = Number(
    (
      await client.query('SELECT octet_length($1::jsonb::text) bytes', [
        JSON.stringify(snapshot),
      ])
    ).rows[0].bytes,
  );
  if (size > LIMIT)
    access.fail(
      'CONTEXT_LIMIT_EXCEEDED',
      409,
      '上下文超过512 KiB，请缩小引用范围',
    );
  return snapshot;
}
async function valid(client, db, ctx, req, run) {
  const p = await runs.plan(client, db, ctx, run.id);
  if (!p || p.baseline !== (await runs.baseline(client, db, ctx, req)))
    access.fail('STALE_PLAN', 409, '计划基线已变化，请重新发起计划');
  if (p.snapshot_version !== 1 || !p.context_snapshot || !p.context_fingerprint)
    access.fail('STALE_PLAN', 409, '历史计划无上下文快照，请新建并批准计划');
  const { fingerprint: stored, ...body } = p.context_snapshot;
  if (stored !== p.context_fingerprint || fingerprint(body) !== stored)
    access.fail('STALE_PLAN', 409, '计划上下文校验失败');
  for (const cap of p.context_snapshot.capabilities.effectiveCaps) {
    const current = await require('./capability-service').available(
      client,
      db,
      ctx,
      cap.id,
    );
    if (current.fingerprint !== cap.fingerprint || current.ver !== cap.ver)
      access.fail('STALE_PLAN', 409, '计划所用能力版本已变化');
  }
  const project = p.context_snapshot.project;
  if (
    (req.project_id || null) !==
    (project
      ? (
          await require('./project-service').required(
            client,
            db,
            ctx,
            project.id,
          )
        ).id
      : null)
  )
    access.fail('STALE_PLAN', 409, '需求项目已变化');
  return p;
}
async function approval(client, db, ctx, p) {
  if (!p.approved_at) access.fail('PLAN_NOT_APPROVED');
  if (
    !p.approved_member_id ||
    p.approved_context_fingerprint !== p.context_fingerprint
  )
    access.fail('STALE_PLAN', 409, '批准对象缺失或已变化，请重新创建计划');
  const member = await members.find(client, db, ctx, p.approved_member_id);
  if (!member?.active || !['owner', 'executor'].includes(member.role))
    access.fail(
      'APPROVER_PERMISSION_REVOKED',
      409,
      '原审批人已无批准权限，请新建计划并批准',
    );
}
module.exports = { capture, valid, approval, bounded };
