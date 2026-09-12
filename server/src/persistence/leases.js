'use strict';
const { allocateIdentifier } = require('./identifiers');
async function get(client, db, ctx, runId) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".leases WHERE tenant_id=$1 AND run_id=$2`,
      [ctx.tenantId, runId],
    )
  ).rows[0];
}
async function save(client, db, ctx, run, input) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'leases');
  return (
    await client.query(
      `INSERT INTO "${db.schema}".leases(id,tenant_id,run_id,public_id,actor,controller,device_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,'active') ON CONFLICT(run_id) DO UPDATE SET actor=excluded.actor,controller=excluded.controller,device_id=excluded.device_id,state='active',revision=leases.revision+1,acquired_at=now() RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        run.id,
        id.publicId,
        ctx.actor,
        input.controller,
        input.bridgeId || null,
      ],
    )
  ).rows[0];
}
async function lose(client, db, ctx, runId) {
  await client.query(
    `UPDATE "${db.schema}".leases SET state='lost',revision=revision+1 WHERE tenant_id=$1 AND run_id=$2 AND state='active'`,
    [ctx.tenantId, runId],
  );
}
function dto(lease, runId) {
  return lease
    ? {
        runId,
        actor: lease.actor,
        controller: lease.controller,
        deviceId: lease.device_id,
        deviceName: lease.controller === 'web' ? '浏览器工作台' : '模拟 Bridge',
        state: lease.state,
        revision: lease.revision,
        acquiredAt: lease.acquired_at,
      }
    : null;
}
module.exports = { get, save, lose, dto };
