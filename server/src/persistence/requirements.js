'use strict';
const { withTransaction } = require('./transaction');
const { allocateIdentifier, resolveIdentifier } = require('./identifiers');
const error = (code) => Object.assign(new Error(code), { code });
function validateContext(ctx) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      ctx?.tenantId || '',
    ) ||
    typeof ctx.actor !== 'string' ||
    !ctx.actor.trim()
  )
    throw error('CONTEXT_REQUIRED');
}
async function read(client, db, tenantId, publicId) {
  const requirement = (
    await client.query(
      `SELECT * FROM "${db.schema}".reqs WHERE tenant_id=$1 AND public_id=$2`,
      [tenantId, publicId],
    )
  ).rows[0];
  if (!requirement) return null;
  const versions = (
    await client.query(
      `SELECT * FROM "${db.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2 ORDER BY stage,version`,
      [tenantId, requirement.id],
    )
  ).rows;
  const audit = (
    await client.query(
      `SELECT * FROM "${db.schema}".audit_logs WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at,public_id`,
      [tenantId, requirement.id],
    )
  ).rows;
  return { requirement, versions, audit };
}
async function writeVersion(
  client,
  db,
  ctx,
  reqId,
  { stage, version, content },
) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'req_versions');
  await client.query(
    `INSERT INTO "${db.schema}".req_versions(id,tenant_id,req_id,public_id,stage,version,content)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      id.id,
      ctx.tenantId,
      reqId,
      id.publicId,
      stage,
      version,
      JSON.stringify(content),
    ],
  );
}
async function audit(client, db, ctx, reqId, action) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'audit_logs');
  await client.query(
    `INSERT INTO "${db.schema}".audit_logs(id,tenant_id,req_id,public_id,actor,action,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id.id, ctx.tenantId, reqId, id.publicId, ctx.actor, action, ''],
  );
}
async function createRequirement(db, ctx, input) {
  validateContext(ctx);
  if (typeof input?.name !== 'string' || !input.name.trim())
    throw error('NAME_REQUIRED');
  return withTransaction(db, async (client) => {
    const id = await allocateIdentifier(client, db, ctx.tenantId, 'reqs');
    await client.query(
      `INSERT INTO "${db.schema}".reqs(id,tenant_id,public_id,name,goal,scope,owner,stage)
      VALUES($1,$2,$3,$4,$5,$6,$7,'idea')`,
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        input.name.trim(),
        input.goal || '',
        input.scope || '',
        input.owner || ctx.actor,
      ],
    );
    await writeVersion(client, db, ctx, id.id, {
      stage: 'idea',
      version: 1,
      content: Object.hasOwn(input, 'content')
        ? input.content
        : { title: input.name.trim() },
    });
    await audit(client, db, ctx, id.id, 'requirement.created');
    return read(client, db, ctx.tenantId, id.publicId);
  });
}
async function addVersion(db, ctx, publicId, version) {
  validateContext(ctx);
  return withTransaction(db, async (client) => {
    const reqId = await resolveIdentifier(
      client,
      db,
      ctx.tenantId,
      'reqs',
      publicId,
    );
    if (!reqId) throw error('REQ_NOT_FOUND');
    await writeVersion(client, db, ctx, reqId, version);
    await audit(client, db, ctx, reqId, 'version.created');
    return read(client, db, ctx.tenantId, publicId);
  });
}
async function getRequirement(db, ctx, publicId) {
  validateContext(ctx);
  return withTransaction(db, async (client) => {
    await client.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    return read(client, db, ctx.tenantId, publicId);
  });
}
module.exports = { createRequirement, getRequirement, addVersion };

async function lock(client, db, ctx, publicId) {
  const row = (
    await client.query(
      'SELECT * FROM "' +
        db.schema +
        '".reqs WHERE tenant_id=$1 AND public_id=$2 FOR UPDATE',
      [ctx.tenantId, publicId],
    )
  ).rows[0];
  if (!row) require('../access').fail('NOT_FOUND', 404);
  return row;
}
async function insert(client, db, ctx, input) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'reqs');
  return (
    await client.query(
      'INSERT INTO "' +
        db.schema +
        '".reqs(id,tenant_id,public_id,name,goal,scope,owner) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        input.name,
        input.goal || '',
        input.scope || '',
        input.owner || ctx.actor,
      ],
    )
  ).rows[0];
}
async function versions(client, db, ctx, reqId) {
  return (
    await client.query(
      'SELECT * FROM "' +
        db.schema +
        '".req_versions WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at,version',
      [ctx.tenantId, reqId],
    )
  ).rows;
}
async function appendVersion(
  client,
  db,
  ctx,
  req,
  stage,
  content,
  base = null,
) {
  const number = Number(
    (
      await client.query(
        'SELECT coalesce(max(version),0)+1 n FROM "' +
          db.schema +
          '".req_versions WHERE tenant_id=$1 AND req_id=$2 AND stage=$3',
        [ctx.tenantId, req.id, stage],
      )
    ).rows[0].n,
  );
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'req_versions');
  const clean = {
    id: req.public_id + '-' + stage + '-v' + number,
    version: number,
    title: content.title || '阶段草稿',
    fields: content.fields,
    confirmed: false,
    review: '待评审',
    comments: [],
  };
  return (
    await client.query(
      'INSERT INTO "' +
        db.schema +
        '".req_versions(id,tenant_id,req_id,public_id,stage,version,content,base_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [
        id.id,
        ctx.tenantId,
        req.id,
        id.publicId,
        stage,
        number,
        JSON.stringify(clean),
        base,
      ],
    )
  ).rows[0];
}
async function touch(client, db, ctx, req, action) {
  const row = (
    await client.query(
      'UPDATE "' +
        db.schema +
        '".reqs SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [ctx.tenantId, req.id],
    )
  ).rows[0];
  await audit(client, db, ctx, req.id, action);
  await require('./events').append(
    client,
    db,
    ctx,
    'req.updated',
    req.public_id,
    row.revision,
    { reqId: req.public_id, action },
  );
  return row;
}
async function staleAfter(client, db, ctx, reqId, stage) {
  const stages = require('../domain/state-machine').STAGES.slice(
    require('../domain/state-machine').STAGES.indexOf(stage) + 1,
  );
  await client.query(
    'UPDATE "' +
      db.schema +
      '".req_versions SET stale=true WHERE tenant_id=$1 AND req_id=$2 AND stage=ANY($3::text[])',
    [ctx.tenantId, reqId, stages],
  );
}
Object.assign(module.exports, {
  lock,
  insert,
  versions,
  appendVersion,
  touch,
  staleAfter,
  audit,
  validateContext,
});
