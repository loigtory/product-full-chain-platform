'use strict';
const repo = require('./verification-baselines');
async function latest(c, db, ctx, req, batch) {
  return (
    await c.query(
      `SELECT DISTINCT ON (case_id) * FROM ${repo.table(db, 'test_results')} WHERE tenant_id=$1 AND req_id=$2 AND batch_id=$3 ORDER BY case_id,sequence DESC`,
      [ctx.tenantId, req.id, batch.id],
    )
  ).rows;
}
async function results(c, db, ctx, req, batch, query = {}) {
  const { limit, offset } = require('../access').page(query);
  const items = (
    await c.query(
      `SELECT * FROM ${repo.table(db, 'test_results')} WHERE tenant_id=$1 AND req_id=$2 AND batch_id=$3 ORDER BY registered_at DESC,public_id DESC LIMIT $4 OFFSET $5`,
      [ctx.tenantId, req.id, batch.id, limit, offset],
    )
  ).rows;
  const total = Number(
    (
      await c.query(
        `SELECT count(*) n FROM ${repo.table(db, 'test_results')} WHERE tenant_id=$1 AND req_id=$2 AND batch_id=$3`,
        [ctx.tenantId, req.id, batch.id],
      )
    ).rows[0].n,
  );
  return { items, total, limit, offset };
}
async function countOpen(c, db, ctx, req) {
  return Number(
    (
      await c.query(
        `SELECT count(*) n FROM ${repo.table(db, 'test_batches')} WHERE tenant_id=$1 AND req_id=$2 AND state='OPEN'`,
        [ctx.tenantId, req.id],
      )
    ).rows[0].n,
  );
}
async function finalize(
  c,
  db,
  ctx,
  req,
  batch,
  state,
  report = null,
  reason = null,
) {
  return (
    await c.query(
      `UPDATE ${repo.table(db, 'test_batches')} SET state=$1,report_version_id=$2,finalized_at=now(),cancel_reason=$6 WHERE tenant_id=$3 AND req_id=$4 AND id=$5 AND state='OPEN' RETURNING *`,
      [state, report?.id || null, ctx.tenantId, req.id, batch.id, reason],
    )
  ).rows[0];
}
async function currentCompleted(c, db, ctx, req, baseline) {
  if (!baseline) return null;
  return (
    (
      await c.query(
        `SELECT * FROM ${repo.table(db, 'test_batches')} WHERE tenant_id=$1 AND req_id=$2 AND baseline_id=$3 AND state='COMPLETED' AND EXISTS(SELECT 1 FROM "${db.schema}".req_versions v WHERE v.tenant_id=$1 AND v.req_id=$2 AND v.id=report_version_id AND NOT v.stale) ORDER BY finalized_at DESC,public_id DESC LIMIT 1`,
        [ctx.tenantId, req.id, baseline.id],
      )
    ).rows[0] || null
  );
}
module.exports = { latest, results, countOpen, finalize, currentCompleted };
