'use strict';
const { allocateIdentifier } = require('./identifiers'),
  { fingerprint } = require('./commands'),
  access = require('../access');
const reqs = require('./requirements');
const table = (db, name) => '"' + db.schema + '"."' + name + '"';
async function find(client, db, ctx, reqId, name, publicId) {
  if (
    !['artifact_versions', 'artifact_groups', 'artifact_proposals'].includes(
      name,
    )
  )
    throw Error('INVALID_ARTIFACT_TABLE');
  return (
    (
      await client.query(
        `SELECT * FROM ${table(db, name)} WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3`,
        [ctx.tenantId, reqId, publicId],
      )
    ).rows[0] || null
  );
}
async function group(client, db, ctx, req, publicId) {
  const row = (
    await client.query(
      `SELECT * FROM ${table(db, 'artifact_groups')} WHERE tenant_id=$1 AND req_id=$2 AND ${publicId ? 'public_id=$3' : 'id=$3'}`,
      [ctx.tenantId, req.id, publicId || req.current_artifact_group_id],
    )
  ).rows[0];
  if (!row) return null;
  const versions = (
    await client.query(
      `SELECT * FROM ${table(db, 'artifact_versions')} WHERE tenant_id=$1 AND req_id=$2 AND id=ANY($3::uuid[])`,
      [ctx.tenantId, req.id, [row.prototype_id, row.acceptance_id]],
    )
  ).rows;
  const prd = (
    await client.query(
      `SELECT * FROM ${table(db, 'req_versions')} WHERE tenant_id=$1 AND req_id=$2 AND id=$3`,
      [ctx.tenantId, req.id, row.prd_id],
    )
  ).rows[0];
  const prototype = versions.find((x) => x.id === row.prototype_id),
    acceptance = versions.find((x) => x.id === row.acceptance_id);
  if (
    prototype?.kind !== 'prototype' ||
    acceptance?.kind !== 'acceptance' ||
    prd?.stage !== 'req'
  )
    access.fail('ARTIFACT_GROUP_CORRUPT', 503);
  return { ...row, prototype, prd, acceptance };
}
function content(g) {
  return g
    ? {
        prototype: g.prototype.content,
        prd: { title: g.prd.content.title, fields: g.prd.content.fields },
        acceptance: g.acceptance.content,
        rules: g.rules,
      }
    : {};
}
async function inputs(client, db, ctx, req, refs = []) {
  if (!Array.isArray(refs) || refs.length > 100)
    access.fail('INVALID_REFERENCE', 400);
  const requested = new Map();
  for (const ref of refs) {
    if (
      !['material', 'attachment'].includes(ref?.kind) ||
      typeof ref.id !== 'string' ||
      !Number.isInteger(ref.version) ||
      ref.version < 1
    )
      access.fail('INVALID_REFERENCE', 400);
    if (requested.has(ref.id)) access.fail('DUPLICATE_REFERENCE', 400);
    requested.set(ref.id, ref);
  }
  const all = (
    await client.query(
      `SELECT m.*,v.id version_id,v.content,v.mime_type,v.file_id,f.hash,f.size,f.status file_status FROM ${table(db, 'materials')} m JOIN ${table(db, 'material_versions')} v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.version=m.version LEFT JOIN ${table(db, 'file_objects')} f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 ORDER BY m.public_id`,
      [ctx.tenantId, req.id],
    )
  ).rows;
  const blockers = [];
  for (const ref of refs) {
    const m = all.find((x) => x.public_id === ref.id);
    if (
      !m ||
      !m.allowed ||
      m.version !== ref.version ||
      m.usage !== ref.kind ||
      m.status !== '已纳入' ||
      (m.file_id && m.file_status !== 'READY')
    )
      blockers.push('引用不可用：' + ref.id);
  }
  const materials = all
    .filter(
      (m) =>
        (m.allowed && m.usage === 'material') || requested.has(m.public_id),
    )
    .map((m) => ({
      id: m.public_id,
      dbId: m.version_id,
      version: m.version,
      hash: m.hash || fingerprint(m.content),
      name: m.name,
      usage: m.usage,
      allowed: m.allowed,
      status: m.status,
      fileId: m.file_id,
      size: Number(m.size || 0),
      mimeType: m.mime_type,
    }));
  if (materials.length > 100) access.fail('CONTEXT_LIMIT_EXCEEDED', 409);
  for (const m of all)
    if (m.status === '待确认影响')
      blockers.push('材料影响待处理：' + m.public_id);
  const versions = await reqs.versions(client, db, ctx, req.id),
    idea = versions
      .filter((x) => x.stage === 'idea')
      .sort((a, b) => b.version - a.version)[0];
  const snapshot = {
    idea: idea
      ? {
          id: idea.public_id,
          dbId: idea.id,
          version: idea.version,
          hash: fingerprint(idea.content),
        }
      : null,
    projectId: req.project_id || null,
    materials,
    explicitRefs: [...refs].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { snapshot, fingerprint: fingerprint(snapshot), blockers };
}
async function verifyFiles(ctx, snapshot) {
  for (const m of snapshot.materials)
    if (m.fileId)
      await require('../files/local-files').read(ctx.tenantId, m.hash);
}
async function jsonSize(client, value, limit = 524288) {
  if (
    Number(
      (
        await client.query('SELECT octet_length($1::jsonb::text) n', [
          JSON.stringify(value),
        ])
      ).rows[0].n,
    ) > limit
  )
    access.fail('ARTIFACT_LIMIT_EXCEEDED', 413);
}
async function addVersion(client, db, ctx, req, kind, value, source, parent) {
  await jsonSize(client, value);
  const identity = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'artifact_versions',
  );
  const version = Number(
    (
      await client.query(
        `SELECT coalesce(max(version),0)+1 n FROM ${table(db, 'artifact_versions')} WHERE tenant_id=$1 AND req_id=$2 AND kind=$3`,
        [ctx.tenantId, req.id, kind],
      )
    ).rows[0].n,
  );
  return (
    await client.query(
      `INSERT INTO ${table(db, 'artifact_versions')}(id,tenant_id,req_id,public_id,kind,version,parent_id,content,fingerprint,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        identity.id,
        ctx.tenantId,
        req.id,
        identity.publicId,
        kind,
        version,
        parent?.id || null,
        JSON.stringify(value),
        fingerprint(value),
        JSON.stringify(source),
        ctx.memberId,
      ],
    )
  ).rows[0];
}
async function addGroup(client, db, ctx, req, old, parts, sourceInputs, rules) {
  const id = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'artifact_groups',
  );
  const hash = fingerprint({
    prototype: parts.prototype.public_id,
    prd: parts.prd.public_id,
    acceptance: parts.acceptance.public_id,
    inputs: sourceInputs.fingerprint,
    rules,
  });
  const row = (
    await client.query(
      `INSERT INTO ${table(db, 'artifact_groups')}(id,tenant_id,req_id,public_id,version,parent_id,prototype_id,prd_id,acceptance_id,input_fingerprint,inputs,rules,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        req.id,
        id.publicId,
        (old?.version || 0) + 1,
        old?.id || null,
        parts.prototype.id,
        parts.prd.id,
        parts.acceptance.id,
        sourceInputs.fingerprint,
        JSON.stringify(sourceInputs.snapshot),
        JSON.stringify(rules),
        hash,
        ctx.memberId,
      ],
    )
  ).rows[0];
  const snapshot = sourceInputs.snapshot;
  for (const item of [
    ...(snapshot.idea
      ? [{ data: snapshot.idea, reqVersionId: snapshot.idea.dbId }]
      : []),
    ...snapshot.materials.map((m) => ({ data: m, materialVersionId: m.dbId })),
  ]) {
    const sid = await allocateIdentifier(
      client,
      db,
      ctx.tenantId,
      'artifact_group_sources',
    );
    await client.query(
      `INSERT INTO ${table(db, 'artifact_group_sources')}(id,tenant_id,req_id,group_id,public_id,material_version_id,req_version_id,source_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        sid.id,
        ctx.tenantId,
        req.id,
        row.id,
        sid.publicId,
        item.materialVersionId || null,
        item.reqVersionId || null,
        JSON.stringify(item.data),
      ],
    );
  }
  await client.query(
    `UPDATE ${table(db, 'reqs')} SET current_artifact_group_id=$1 WHERE tenant_id=$2 AND id=$3`,
    [row.id, ctx.tenantId, req.id],
  );
  return row;
}
async function pendingRuns(client, db, ctx, req) {
  return (
    await client.query(
      `SELECT public_id,status FROM ${table(db, 'runs')} WHERE tenant_id=$1 AND req_id=$2 AND status IN ('WAITING_APPROVAL','RUNNING','CANCELLING','UNKNOWN') ORDER BY public_id`,
      [ctx.tenantId, req.id],
    )
  ).rows;
}
async function confirmations(client, db, ctx, req) {
  return (
    await client.query(
      `SELECT a.*,m.public_id member_public_id,m.active member_active,m.role current_role,g.public_id group_public_id FROM ${table(db, 'artifact_confirmations')} a JOIN ${table(db, 'artifact_groups')} g ON g.tenant_id=a.tenant_id AND g.id=a.group_id JOIN ${table(db, 'members')} m ON m.tenant_id=a.tenant_id AND m.id=a.member_id WHERE a.tenant_id=$1 AND a.req_id=$2 ORDER BY a.created_at DESC,a.public_id DESC`,
      [ctx.tenantId, req.id],
    )
  ).rows;
}
module.exports = {
  table,
  find,
  group,
  content,
  inputs,
  verifyFiles,
  jsonSize,
  addVersion,
  addGroup,
  pendingRuns,
  confirmations,
};
