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
