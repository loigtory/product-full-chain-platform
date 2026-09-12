'use strict';
const { allocateIdentifier } = require('./identifiers');
const { fingerprint } = require('./commands');
async function find(client, db, ctx, id, lock = false) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".runs WHERE tenant_id=$1 AND public_id=$2 ${lock ? 'FOR UPDATE' : ''}`,
      [ctx.tenantId, id],
    )
  ).rows[0];
}
async function baseline(client, db, ctx, req) {
  const versions = (
    await client.query(
      `SELECT public_id,stage,version,confirmed_at,stale FROM "${db.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2 ORDER BY stage,version`,
      [ctx.tenantId, req.id],
    )
  ).rows;
  return fingerprint({
    stage: req.stage,
    materialRevision: req.material_revision,
    versions,
  });
}
async function create(client, db, ctx, req, input, parent, snapshot) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'runs');
  const run = (
    await client.query(
      `INSERT INTO "${db.schema}".runs(id,tenant_id,req_id,public_id,parent_id,status) VALUES($1,$2,$3,$4,$5,'WAITING_APPROVAL') RETURNING *`,
      [id.id, ctx.tenantId, req.id, id.publicId, parent?.id || null],
    )
  ).rows[0];
  const planId = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'run_plans',
  );
  await client.query(
    `INSERT INTO "${db.schema}".run_plans(id,tenant_id,run_id,public_id,plan,baseline,snapshot_version,context_snapshot,context_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      planId.id,
      ctx.tenantId,
      run.id,
      planId.publicId,
      input.plan || '模拟：读取需求、生成输出、汇总结果',
      await baseline(client, db, ctx, req),
      snapshot.snapshotVersion,
      JSON.stringify(snapshot),
      snapshot.fingerprint,
    ],
  );
  return run;
}
async function plan(client, db, ctx, runId) {
  return (
    await client.query(
      `SELECT p.*,m.public_id approved_member_public_id FROM "${db.schema}".run_plans p LEFT JOIN "${db.schema}".members m ON m.tenant_id=p.tenant_id AND m.id=p.approved_member_id WHERE p.tenant_id=$1 AND p.run_id=$2`,
      [ctx.tenantId, runId],
    )
  ).rows[0];
}
module.exports = { find, baseline, create, plan };
