'use strict';
const repo = require('./verification-baselines');
async function unclosed(c, db, ctx, req) {
  return (
    await c.query(
      `SELECT * FROM ${repo.table(db, 'defects')} WHERE tenant_id=$1 AND req_id=$2 AND state<>'CLOSED' ORDER BY created_at`,
      [ctx.tenantId, req.id],
    )
  ).rows;
}
async function events(c, db, ctx, req, defect, query = {}) {
  const { limit, offset } = require('../access').page(query);
  const items = (
    await c.query(
      `SELECT * FROM ${repo.table(db, 'defect_events')} WHERE tenant_id=$1 AND req_id=$2 AND defect_id=$3 ORDER BY sequence DESC LIMIT $4 OFFSET $5`,
      [ctx.tenantId, req.id, defect.id, limit, offset],
    )
  ).rows;
  const total = Number(
    (
      await c.query(
        `SELECT count(*) n FROM ${repo.table(db, 'defect_events')} WHERE tenant_id=$1 AND req_id=$2 AND defect_id=$3`,
        [ctx.tenantId, req.id, defect.id],
      )
    ).rows[0].n,
  );
  return { items, total, limit, offset };
}
async function event(
  c,
  db,
  ctx,
  req,
  defect,
  state,
  comment,
  result = null,
  dev = null,
) {
  const sequence = Number(
    (
      await c.query(
        `SELECT coalesce(max(sequence),0)+1 n FROM ${repo.table(db, 'defect_events')} WHERE tenant_id=$1 AND req_id=$2 AND defect_id=$3`,
        [ctx.tenantId, req.id, defect.id],
      )
    ).rows[0].n,
  );
  return repo.insert(c, db, ctx, req, 'defect_events', {
    defect_id: defect.id,
    sequence,
    state,
    comment,
    result_id: result?.id || null,
    dev_version_id: dev?.id || null,
    member_id: ctx.memberId,
  });
}
async function state(c, db, ctx, req, defect, next, dev) {
  return (
    await c.query(
      `UPDATE ${repo.table(db, 'defects')} SET state=$1,resolved_dev_version_id=$2 WHERE tenant_id=$3 AND req_id=$4 AND id=$5 RETURNING *`,
      [
        next,
        dev?.id || defect.resolved_dev_version_id || null,
        ctx.tenantId,
        req.id,
        defect.id,
      ],
    )
  ).rows[0];
}
async function fromResult(c, db, ctx, req, id) {
  return (
    (
      await c.query(
        'SELECT public_id FROM ' +
          repo.table(db, 'defects') +
          ' WHERE tenant_id=$1 AND req_id=$2 AND source_result_id=$3',
        [ctx.tenantId, req.id, id],
      )
    ).rows[0] || null
  );
}
async function latestProofs(c, db, ctx, req) {
  return (
    await c.query(
      `SELECT e.* FROM ${repo.table(db, 'defects')} d JOIN LATERAL(SELECT * FROM ${repo.table(db, 'defect_events')} WHERE tenant_id=d.tenant_id AND req_id=d.req_id AND defect_id=d.id ORDER BY sequence DESC LIMIT 1) e ON true WHERE d.tenant_id=$1 AND d.req_id=$2 AND d.state='CLOSED'`,
      [ctx.tenantId, req.id],
    )
  ).rows;
}
module.exports = { unclosed, events, event, state, fromResult, latestProofs };
