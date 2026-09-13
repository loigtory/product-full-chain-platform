'use strict';
const repo = require('./verification-baselines');
async function current(c, db, ctx, req, baseline) {
  if (!baseline) return null;
  return (
    (
      await c.query(
        `SELECT a.*,m.active member_active,m.role current_role FROM ${repo.table(db, 'product_acceptances')} a JOIN "${db.schema}".members m ON m.tenant_id=a.tenant_id AND m.id=a.member_id WHERE a.tenant_id=$1 AND a.req_id=$2 AND a.baseline_id=$3 ORDER BY a.created_at DESC,a.public_id DESC LIMIT 1`,
        [ctx.tenantId, req.id, baseline.id],
      )
    ).rows[0] || null
  );
}
module.exports = { current };
