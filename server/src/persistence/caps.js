'use strict';
const { allocateIdentifier } = require('./identifiers');
async function find(client, db, ctx, id) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".caps WHERE tenant_id=$1 AND (public_id=$2 OR id::text=$2)`,
      [ctx.tenantId, id],
    )
  ).rows[0];
}
async function duplicate(client, db, ctx, name, ver) {
  return (
    (
      await client.query(
        `SELECT 1 FROM "${db.schema}".caps WHERE tenant_id=$1 AND name=$2 AND ver=$3`,
        [ctx.tenantId, name, ver],
      )
    ).rowCount > 0
  );
}
async function insert(client, db, ctx, input) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'caps');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".caps(id,tenant_id,public_id,name,type,protocol,endpoint,src,ver,description,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        input.name,
        input.type,
        input.protocol,
        input.endpoint,
        input.src,
        input.ver,
        input.desc,
        input.fingerprint,
      ],
    )
  ).rows[0];
}
async function review(client, db, ctx, row) {
  return (
    await client.query(
      `UPDATE "${db.schema}".caps SET reviewed_by=$1,reviewed_at=now(),revision=revision+1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [ctx.memberId, ctx.tenantId, row.id],
    )
  ).rows[0];
}
async function toggle(client, db, ctx, row, enabled) {
  return (
    await client.query(
      `UPDATE "${db.schema}".caps SET enabled=$1,revision=revision+1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [enabled, ctx.tenantId, row.id],
    )
  ).rows[0];
}
async function list(
  client,
  db,
  ctx,
  { limit, offset, q = '', pending = null },
) {
  const params = [ctx.tenantId, q, pending];
  const where = `tenant_id=$1 AND (position(lower($2) in lower(name||' '||description))>0) AND ($3::boolean IS NULL OR (reviewed_at IS NULL)=$3)`;
  const items = (
    await client.query(
      `SELECT * FROM "${db.schema}".caps WHERE ${where} ORDER BY created_at,id LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    )
  ).rows;
  const total = Number(
    (
      await client.query(
        `SELECT count(*) n FROM "${db.schema}".caps WHERE ${where}`,
        params,
      )
    ).rows[0].n,
  );
  return { items, total };
}
module.exports = { find, duplicate, insert, review, toggle, list };
