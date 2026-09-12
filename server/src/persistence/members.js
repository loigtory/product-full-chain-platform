'use strict';
const { allocateIdentifier } = require('./identifiers');
async function lockTenant(client, db, tenantId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    db.schema + ':membership:' + tenantId,
  ]);
}
async function byName(client, db, ctx) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".members WHERE tenant_id=$1 AND name=$2`,
      [ctx.tenantId, ctx.actor],
    )
  ).rows[0];
}
async function find(client, db, ctx, id) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".members WHERE tenant_id=$1 AND (public_id=$2 OR id::text=$2)`,
      [ctx.tenantId, id],
    )
  ).rows[0];
}
async function insert(client, db, tenantId, input) {
  const id = await allocateIdentifier(client, db, tenantId, 'members');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".members(id,tenant_id,public_id,name,role) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [id.id, tenantId, id.publicId, input.name, input.role],
    )
  ).rows[0];
}
async function owners(client, db, ctx) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".members WHERE tenant_id=$1 AND active AND role='owner'`,
      [ctx.tenantId],
    )
  ).rows;
}
async function update(client, db, ctx, row, role, active) {
  return (
    await client.query(
      `UPDATE "${db.schema}".members SET role=$1,active=$2,disabled_at=CASE WHEN $2 THEN NULL ELSE now() END,revision=revision+1 WHERE tenant_id=$3 AND id=$4 RETURNING *`,
      [role, active, ctx.tenantId, row.id],
    )
  ).rows[0];
}
async function list(client, db, ctx, { limit, offset }) {
  const items = (
    await client.query(
      `SELECT * FROM "${db.schema}".members WHERE tenant_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3`,
      [ctx.tenantId, limit, offset],
    )
  ).rows;
  const total = Number(
    (
      await client.query(
        `SELECT count(*) n FROM "${db.schema}".members WHERE tenant_id=$1`,
        [ctx.tenantId],
      )
    ).rows[0].n,
  );
  return { items, total };
}
module.exports = { lockTenant, byName, find, insert, owners, update, list };
