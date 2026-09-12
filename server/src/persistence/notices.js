'use strict';
const { allocateIdentifier } = require('./identifiers');
async function append(client, db, ctx, req, text, level = 'info') {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'notices');
  await client.query(
    `INSERT INTO "${db.schema}".notices(id,tenant_id,req_id,public_id,text,level) VALUES($1,$2,$3,$4,$5,$6)`,
    [id.id, ctx.tenantId, req.id, id.publicId, text, level],
  );
  await require('./events').append(
    client,
    db,
    ctx,
    'notice',
    req.public_id,
    req.revision || 0,
    { id: id.publicId, reqId: req.public_id, text, level, read: false },
  );
}
async function list(client, db, ctx) {
  return (
    await client.query(
      `SELECT n.public_id id,r.public_id "reqId",n.text,n.level,n.created_at at,(nr.actor IS NOT NULL) read FROM "${db.schema}".notices n JOIN "${db.schema}".reqs r ON r.tenant_id=n.tenant_id AND r.id=n.req_id LEFT JOIN "${db.schema}".notice_reads nr ON nr.tenant_id=n.tenant_id AND nr.notice_id=n.id AND nr.actor=$2 WHERE n.tenant_id=$1 ORDER BY n.created_at DESC LIMIT 200`,
      [ctx.tenantId, ctx.actor],
    )
  ).rows;
}
async function mark(client, db, ctx, id) {
  const r = await client.query(
    `INSERT INTO "${db.schema}".notice_reads(tenant_id,notice_id,actor) SELECT tenant_id,id,$2 FROM "${db.schema}".notices WHERE tenant_id=$1 AND ($3::text IS NULL OR public_id=$3) ON CONFLICT DO NOTHING`,
    [ctx.tenantId, ctx.actor, id || null],
  );
  return r.rowCount;
}
module.exports = { append, list, mark };
