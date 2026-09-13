'use strict';
const { allocateIdentifier } = require('./identifiers');
const { fail } = require('../access');
const { iso } = require('../domain/dto');
async function create(client, db, ctx, req, input) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'messages');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".messages(id,tenant_id,req_id,public_id,turn_id,role,stage,content,status,reply_to,parent_message_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        req.id,
        id.publicId,
        input.turnId,
        input.role,
        input.stage,
        input.content,
        input.status,
        input.replyTo || null,
        input.parentId || null,
        JSON.stringify(input.metadata || {}),
      ],
    )
  ).rows[0];
}
async function find(client, db, ctx, reqId, publicId) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".messages WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3`,
      [ctx.tenantId, reqId, publicId],
    )
  ).rows[0];
}
async function references(client, db, ctx, reqId, refs) {
  if (!Array.isArray(refs) || refs.length > 40) fail('INVALID_REFERENCE', 400);
  if (refs.filter((r) => r.kind === 'attachment').length > 20)
    fail('ATTACHMENT_LIMIT', 413);
  const result = [];
  let attachmentCount = 0,
    bytes = 0;
  for (const ref of refs) {
    if (ref.kind === 'material' || ref.kind === 'attachment') {
      const row = (
        await client.query(
          `SELECT m.*,v.id version_id,v.file_id,v.mime_type,f.size FROM "${db.schema}".materials m JOIN "${db.schema}".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.version=m.version LEFT JOIN "${db.schema}".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 AND m.public_id=$3`,
          [ctx.tenantId, reqId, ref.id],
        )
      ).rows[0];
      if (
        !row ||
        !row.allowed ||
        row.status !== '已纳入' ||
        row.version !== Number(ref.version)
      )
        fail('STALE_REFERENCE');
      if (ref.kind === 'attachment') {
        if (row.usage !== 'attachment') fail('INVALID_REFERENCE', 400);
        attachmentCount++;
        bytes += Number(row.size || 0);
      }
      result.push({
        kind: ref.kind,
        id: row.public_id,
        version: row.version,
        label: row.name,
        name: row.name,
        size: Number(row.size || 0),
        mimeType: row.mime_type,
        materialVersionId: row.version_id,
      });
    } else if (ref.kind === 'linked-artifact') {
      const row = (
        await client.query(
          'SELECT * FROM "' +
            db.schema +
            '".artifact_versions WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3',
          [ctx.tenantId, reqId, ref.id],
        )
      ).rows[0];
      const req = (
        await client.query(
          'SELECT * FROM "' + db.schema + '".reqs WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, reqId],
        )
      ).rows[0];
      const group = await require('./artifacts').group(client, db, ctx, req);
      if (
        !row ||
        row.version !== Number(ref.version) ||
        ![group?.prototype_id, group?.acceptance_id].includes(row.id)
      )
        fail('STALE_REFERENCE');
      const inputs = await require('./artifacts').inputs(
        client,
        db,
        ctx,
        req,
        group.inputs.explicitRefs,
      );
      if (
        inputs.blockers.length ||
        inputs.fingerprint !== group.input_fingerprint
      )
        fail('STALE_REFERENCE');
      await require('./artifacts').verifyFiles(ctx, inputs.snapshot);
      result.push({
        kind: ref.kind,
        id: row.public_id,
        version: row.version,
        stage: row.kind,
        label: row.kind === 'prototype' ? '原型' : '验收项',
        artifactVersionId: row.id,
      });
    } else if (ref.kind === 'artifact') {
      const row = (
        await client.query(
          `SELECT * FROM "${db.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3`,
          [ctx.tenantId, reqId, ref.id],
        )
      ).rows[0];
      if (!row || row.stale) fail('STALE_REFERENCE');
      const latest = (
        await client.query(
          `SELECT max(version) n FROM "${db.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2 AND stage=$3`,
          [ctx.tenantId, reqId, row.stage],
        )
      ).rows[0].n;
      if (row.version !== latest) fail('STALE_REFERENCE');
      result.push({
        kind: 'artifact',
        id: row.public_id,
        version: row.version,
        stage: row.stage,
        label: row.content.title,
        reqVersionId: row.id,
      });
    } else fail('INVALID_REFERENCE', 400);
  }
  if (attachmentCount > 20 || bytes > 52428800) fail('ATTACHMENT_LIMIT', 413);
  if (new Set(result.map((r) => r.kind + ':' + r.id)).size !== result.length)
    fail('DUPLICATE_REFERENCE', 400);
  return result;
}
async function attach(client, db, ctx, message, refs) {
  for (const ref of refs) {
    const id = await allocateIdentifier(
      client,
      db,
      ctx.tenantId,
      'message_references',
    );
    await client.query(
      `INSERT INTO "${db.schema}".message_references(id,tenant_id,message_id,public_id,material_version_id,req_version_id,artifact_version_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id.id,
        ctx.tenantId,
        message.id,
        id.publicId,
        ref.materialVersionId || null,
        ref.reqVersionId || null,
        ref.artifactVersionId || null,
      ],
    );
  }
}
async function project(client, db, ctx, row, reqPublicId) {
  const related = [
    row.reply_to,
    row.parent_message_id,
    row.retry_message_id,
  ].filter(Boolean);
  const publicIds = related.length
    ? (
        await client.query(
          `SELECT id,public_id FROM "${db.schema}".messages WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
          [ctx.tenantId, related],
        )
      ).rows
    : [];
  const idFor = (id) => publicIds.find((r) => r.id === id)?.public_id || null;
  const { full: _full, ...meta } = row.metadata;
  return {
    id: row.public_id,
    reqId: reqPublicId,
    turnId: row.turn_id,
    role: row.role,
    stage: row.stage,
    content: row.content,
    text: row.content,
    status: row.status,
    revision: row.revision,
    typing: row.status === 'generating',
    replyTo: idFor(row.reply_to),
    parentMessageId: idFor(row.parent_message_id),
    retryMessageId: idFor(row.retry_message_id),
    source: row.source,
    simulated: true,
    at: iso(row.created_at),
    ...meta,
  };
}
async function list(client, db, ctx, req, stage, offset = 0, limit = 20) {
  const rows = (
    await client.query(
      `SELECT * FROM "${db.schema}".messages WHERE tenant_id=$1 AND req_id=$2 AND ($3::text IS NULL OR stage=$3) ORDER BY created_at,id OFFSET $4 LIMIT $5`,
      [ctx.tenantId, req.id, stage || null, offset, limit],
    )
  ).rows;
  const total = Number(
    (
      await client.query(
        `SELECT count(*) n FROM "${db.schema}".messages WHERE tenant_id=$1 AND req_id=$2 AND ($3::text IS NULL OR stage=$3)`,
        [ctx.tenantId, req.id, stage || null],
      )
    ).rows[0].n,
  );
  return {
    items: await Promise.all(
      rows.map((r) => project(client, db, ctx, r, req.public_id)),
    ),
    total,
  };
}
module.exports = { create, find, references, attach, project, list };
