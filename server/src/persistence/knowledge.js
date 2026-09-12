'use strict';
const { allocateIdentifier } = require('./identifiers');
async function insert(client, db, ctx, v) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'knowledge');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".knowledge(id,tenant_id,public_id,title,type,content,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        v.title,
        v.type,
        v.content,
        JSON.stringify(v.tags),
        ctx.memberId,
      ],
    )
  ).rows[0];
}
const where = `tenant_id=$1 AND ($2::text IS NULL OR type=$2) AND (position(lower($3) in lower(title))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(tags) tag WHERE position(lower($3) in lower(tag))>0))`;
async function list(c, db, ctx, { type, q, limit, offset }) {
  const args = [ctx.tenantId, type, q],
    total = Number(
      (
        await c.query(
          `SELECT count(*) FROM "${db.schema}".knowledge WHERE ${where}`,
          args,
        )
      ).rows[0].count,
    );
  return {
    items: (
      await c.query(
        `SELECT * FROM "${db.schema}".knowledge WHERE ${where} ORDER BY created_at,id LIMIT $4 OFFSET $5`,
        [...args, limit, offset],
      )
    ).rows,
    total,
    limit,
    offset,
  };
}
async function matches(c, db, ctx, text) {
  return (
    await c.query(
      `SELECT * FROM "${db.schema}".knowledge WHERE tenant_id=$1 AND (position(lower(title) in lower($2))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(tags) tag WHERE position(lower(tag) in lower($2))>0)) ORDER BY created_at,id LIMIT 3`,
      [ctx.tenantId, text],
    )
  ).rows;
}
async function link(c, db, ctx, reqId, k, snapshot) {
  await c.query(
    `INSERT INTO "${db.schema}".knowledge_links(tenant_id,req_id,knowledge_id,version,snapshot) VALUES($1,$2,$3,$4,$5)`,
    [ctx.tenantId, reqId, k.id, k.version, JSON.stringify(snapshot)],
  );
}
async function refs(c, db, ctx, reqId) {
  return (
    await c.query(
      `SELECT snapshot FROM "${db.schema}".knowledge_links WHERE tenant_id=$1 AND req_id=$2 ORDER BY snapshot->>'id'`,
      [ctx.tenantId, reqId],
    )
  ).rows.map((r) => r.snapshot);
}
module.exports = { insert, list, matches, link, refs };
