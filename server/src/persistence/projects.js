'use strict';
const { allocateIdentifier } = require('./identifiers');
async function find(client, db, ctx, id) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".projects WHERE tenant_id=$1 AND (public_id=$2 OR id::text=$2)`,
      [ctx.tenantId, id],
    )
  ).rows[0];
}
async function insert(client, db, ctx, v) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'projects');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".projects(id,tenant_id,public_id,name,path,repo,branch,tech,source,loaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        v.name,
        v.path,
        v.repo,
        v.branch,
        JSON.stringify(v.tech),
        v.source,
        ctx.memberId,
      ],
    )
  ).rows[0];
}
async function list(client, db, ctx, { limit, offset, q }) {
  const args = [ctx.tenantId, q];
  const total = Number(
    (
      await client.query(
        `SELECT count(*) FROM "${db.schema}".projects WHERE tenant_id=$1 AND position(lower($2) in lower(name))>0`,
        args,
      )
    ).rows[0].count,
  );
  const items = (
    await client.query(
      `SELECT * FROM "${db.schema}".projects WHERE tenant_id=$1 AND position(lower($2) in lower(name))>0 ORDER BY loaded_at,id LIMIT $3 OFFSET $4`,
      [...args, limit, offset],
    )
  ).rows;
  return { items, total, limit, offset };
}
module.exports = { find, insert, list };
