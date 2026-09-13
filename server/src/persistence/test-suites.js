'use strict';
const repo = require('./verification-baselines');
async function cases(c, db, ctx, req, suite) {
  return (
    await c.query(
      `SELECT * FROM ${repo.table(db, 'test_cases')} WHERE tenant_id=$1 AND req_id=$2 AND suite_id=$3 ORDER BY ordinal`,
      [ctx.tenantId, req.id, suite.id],
    )
  ).rows;
}
async function create(c, db, ctx, req, group, parent, value) {
  const version = Number(
    (
      await c.query(
        `SELECT coalesce(max(version),0)+1 n FROM ${repo.table(db, 'test_suites')} WHERE tenant_id=$1 AND req_id=$2`,
        [ctx.tenantId, req.id],
      )
    ).rows[0].n,
  );
  const row = await repo.insert(c, db, ctx, req, 'test_suites', {
    group_id: group.id,
    parent_id: parent?.id || null,
    version,
    title: value.title,
    status: value.status,
    gaps: JSON.stringify(value.gaps),
    fingerprint: require('./commands').fingerprint(value),
    created_by: ctx.memberId,
  });
  for (let i = 0; i < value.cases.length; i++)
    await repo.insert(c, db, ctx, req, 'test_cases', {
      suite_id: row.id,
      case_id: value.cases[i].caseId,
      ordinal: i + 1,
      content: JSON.stringify(value.cases[i]),
    });
  return row;
}
async function adopt(c, db, ctx, req, suite) {
  const row = (
    await c.query(
      `UPDATE "${db.schema}".reqs SET current_test_suite_id=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [suite.id, ctx.tenantId, req.id],
    )
  ).rows[0];
  Object.assign(req, row);
}
module.exports = { cases, create, adopt };
