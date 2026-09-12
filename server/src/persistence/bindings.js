'use strict';
async function get(client, db, ctx, stage) {
  const row = (
    await client.query(
      `SELECT revision FROM "${db.schema}".binding_sets WHERE tenant_id=$1 AND stage=$2`,
      [ctx.tenantId, stage],
    )
  ).rows[0];
  const caps = (
    await client.query(
      `SELECT c.* FROM "${db.schema}".cap_bindings b JOIN "${db.schema}".caps c ON c.tenant_id=b.tenant_id AND c.id=b.cap_id WHERE b.tenant_id=$1 AND b.stage=$2 ORDER BY c.public_id`,
      [ctx.tenantId, stage],
    )
  ).rows;
  return {
    stage,
    revision: row?.revision || 0,
    capIds: caps.map((c) => c.public_id),
    caps,
  };
}
async function save(client, db, ctx, stage, revision, caps) {
  await client.query(
    `INSERT INTO "${db.schema}".binding_sets(tenant_id,stage,revision) VALUES($1,$2,$3) ON CONFLICT(tenant_id,stage) DO UPDATE SET revision=$3`,
    [ctx.tenantId, stage, revision + 1],
  );
  await client.query(
    `DELETE FROM "${db.schema}".cap_bindings WHERE tenant_id=$1 AND stage=$2`,
    [ctx.tenantId, stage],
  );
  for (const cap of caps)
    await client.query(
      `INSERT INTO "${db.schema}".cap_bindings(tenant_id,stage,cap_id) VALUES($1,$2,$3)`,
      [ctx.tenantId, stage, cap.id],
    );
  return get(client, db, ctx, stage);
}
async function overrides(client, db, ctx, reqId, stage) {
  return (
    await client.query(
      `SELECT o.enabled AS override_enabled,c.* FROM "${db.schema}".req_cap_overrides o JOIN "${db.schema}".caps c ON c.tenant_id=o.tenant_id AND c.id=o.cap_id WHERE o.tenant_id=$1 AND o.req_id=$2 AND o.stage=$3 ORDER BY c.public_id`,
      [ctx.tenantId, reqId, stage],
    )
  ).rows;
}
async function saveOverrides(client, db, ctx, reqId, stage, items) {
  await client.query(
    `DELETE FROM "${db.schema}".req_cap_overrides WHERE tenant_id=$1 AND req_id=$2 AND stage=$3`,
    [ctx.tenantId, reqId, stage],
  );
  for (const item of items)
    await client.query(
      `INSERT INTO "${db.schema}".req_cap_overrides(tenant_id,req_id,stage,cap_id,enabled) VALUES($1,$2,$3,$4,$5)`,
      [ctx.tenantId, reqId, stage, item.cap.id, item.enabled],
    );
}
module.exports = { get, save, overrides, saveOverrides };
