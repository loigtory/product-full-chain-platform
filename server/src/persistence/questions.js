'use strict';
const { allocateIdentifier } = require('./identifiers');
async function create(client, db, ctx, reqId, questions) {
  for (const q of questions) {
    const id = await allocateIdentifier(client, db, ctx.tenantId, 'questions');
    await client.query(
      `INSERT INTO "${db.schema}".questions(id,tenant_id,req_id,public_id,q) VALUES($1,$2,$3,$4,$5)`,
      [id.id, ctx.tenantId, reqId, id.publicId, q],
    );
  }
}
async function list(client, db, ctx, reqId) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".questions WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at,public_id`,
      [ctx.tenantId, reqId],
    )
  ).rows;
}
async function answer(client, db, ctx, reqId, qid, text) {
  return (
    await client.query(
      `UPDATE "${db.schema}".questions SET answer=$1,answered_by=$2,revision=revision+1 WHERE tenant_id=$3 AND req_id=$4 AND public_id=$5 RETURNING *`,
      [text, ctx.actor, ctx.tenantId, reqId, qid],
    )
  ).rows[0];
}
module.exports = { create, list, answer };
