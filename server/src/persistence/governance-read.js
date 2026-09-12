'use strict';
const where =
  'tenant_id=$1 AND ($2::text IS NULL OR actor=$2) AND ($3::text IS NULL OR action=$3)';
async function audit(c, db, ctx, { actor, action, limit, offset }) {
  return (
    await c.query(
      `SELECT public_id id,actor,action,detail,entity_type "entityType",entity_id "entityId",created_at time FROM "${db.schema}".audit_logs WHERE ${where} ORDER BY created_at,id LIMIT $4 OFFSET $5`,
      [ctx.tenantId, actor, action, limit, offset],
    )
  ).rows;
}
async function count(c, db, ctx, { actor, action }) {
  return Number(
    (
      await c.query(
        `SELECT count(*) FROM "${db.schema}".audit_logs WHERE ${where}`,
        [ctx.tenantId, actor, action],
      )
    ).rows[0].count,
  );
}
async function budget(c, db, ctx, period) {
  return (
    await c.query(
      `SELECT * FROM "${db.schema}".budget_accounts WHERE tenant_id=$1 AND period=$2`,
      [ctx.tenantId, period],
    )
  ).rows[0];
}
module.exports = { audit, count, budget };
