'use strict';
const access = require('../access');
const { allocateIdentifier } = require('./identifiers');
const names = new Set(require('./verification-readiness').tables);
function table(db, name) {
  if (!names.has(name)) throw Error('INVALID_VERIFICATION_TABLE');
  return '"' + db.schema + '"."' + name + '"';
}
async function insert(c, db, ctx, req, name, fields) {
  const ident = await allocateIdentifier(c, db, ctx.tenantId, name);
  const values = {
    id: ident.id,
    tenant_id: ctx.tenantId,
    req_id: req.id,
    public_id: ident.publicId,
    ...fields,
  };
  const keys = Object.keys(values);
  if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw Error('INVALID_COLUMN');
  return (
    await c.query(
      `INSERT INTO ${table(db, name)}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      Object.values(values),
    )
  ).rows[0];
}
async function find(c, db, ctx, req, name, id, internal = false) {
  return (
    (
      await c.query(
        `SELECT * FROM ${table(db, name)} WHERE tenant_id=$1 AND req_id=$2 AND ${internal ? 'id' : 'public_id'}=$3`,
        [ctx.tenantId, req.id, id],
      )
    ).rows[0] || null
  );
}
async function required(c, db, ctx, req, name, id, internal = false) {
  const row = await find(c, db, ctx, req, name, id, internal);
  if (!row) access.fail('NOT_FOUND', 404);
  return row;
}
async function list(c, db, ctx, req, name, query = {}) {
  const { limit, offset } = access.page(query);
  const order = name === 'test_suites' ? 'version' : 'created_at';
  const items = (
    await c.query(
      `SELECT * FROM ${table(db, name)} WHERE tenant_id=$1 AND req_id=$2 ORDER BY ${order} DESC,public_id DESC LIMIT $3 OFFSET $4`,
      [ctx.tenantId, req.id, limit, offset],
    )
  ).rows;
  const total = Number(
    (
      await c.query(
        `SELECT count(*) n FROM ${table(db, name)} WHERE tenant_id=$1 AND req_id=$2`,
        [ctx.tenantId, req.id],
      )
    ).rows[0].n,
  );
  return { items, total, limit, offset };
}
async function evidenceRows(c, db, ctx, req, refs) {
  const out = [];
  for (const ref of refs) {
    const row = (
      await c.query(
        `SELECT m.public_id,m.name,m.version current_version,m.allowed,m.status,m.usage,v.id version_id,v.version,v.file_id,f.hash,f.size,f.status file_status FROM "${db.schema}".materials m JOIN "${db.schema}".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id LEFT JOIN "${db.schema}".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 AND m.public_id=$3 AND v.version=$4`,
        [ctx.tenantId, req.id, ref.id, ref.version],
      )
    ).rows[0];
    if (
      !row ||
      !row.allowed ||
      row.usage !== 'attachment' ||
      row.status !== '已纳入' ||
      row.current_version !== ref.version ||
      row.file_status !== 'READY' ||
      !row.hash
    )
      access.fail(
        'VERIFICATION_EVIDENCE_UNAVAILABLE',
        409,
        '证据不可用：' + ref.id,
      );
    out.push(row);
  }
  return out;
}
async function saveRefs(c, db, ctx, req, kind, id, rows) {
  if (
    !['baseline_id', 'result_id', 'defect_event_id', 'acceptance_id'].includes(
      kind,
    )
  )
    throw Error('INVALID_EVIDENCE_OWNER');
  for (const r of rows)
    await insert(c, db, ctx, req, 'verification_refs', {
      material_version_id: r.version_id,
      [kind]: id,
      source_data: JSON.stringify({
        id: r.public_id,
        version: r.version,
        hash: r.hash,
        size: Number(r.size),
      }),
    });
}
async function refs(c, db, ctx, req, kind, id) {
  if (
    !['baseline_id', 'result_id', 'defect_event_id', 'acceptance_id'].includes(
      kind,
    )
  )
    throw Error('INVALID_EVIDENCE_OWNER');
  return (
    await c.query(
      `SELECT source_data FROM ${table(db, 'verification_refs')} WHERE tenant_id=$1 AND req_id=$2 AND ${kind}=$3 ORDER BY public_id`,
      [ctx.tenantId, req.id, id],
    )
  ).rows.map((r) => r.source_data);
}
async function member(c, db, ctx, id) {
  return (
    await c.query(
      `SELECT public_id,name,role,active FROM "${db.schema}".members WHERE tenant_id=$1 AND id=$2`,
      [ctx.tenantId, id],
    )
  ).rows[0];
}
async function invalidate(c, db, ctx, req) {
  const row = (
    await c.query(
      `UPDATE "${db.schema}".reqs SET verification_epoch=verification_epoch+1,stage=CASE WHEN stage IN ('test','accept','release') THEN 'dev' ELSE stage END WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [ctx.tenantId, req.id],
    )
  ).rows[0];
  await require('./requirements').staleAfter(c, db, ctx, req.id, 'dev');
  Object.assign(req, row);
  return row;
}
async function stage(c, db, ctx, req, next) {
  const row = (
    await c.query(
      `UPDATE "${db.schema}".reqs SET stage=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [next, ctx.tenantId, req.id],
    )
  ).rows[0];
  Object.assign(req, row);
}
async function publicId(c, db, ctx, req, name, id) {
  if (!id) return null;
  if (
    !names.has(name) &&
    !['req_versions', 'artifact_groups', 'artifact_confirmations'].includes(
      name,
    )
  )
    throw Error('INVALID_REFERENCE_TABLE');
  return (
    (
      await c.query(
        `SELECT public_id FROM "${db.schema}"."${name}" WHERE tenant_id=$1 AND req_id=$2 AND id=$3`,
        [ctx.tenantId, req.id, id],
      )
    ).rows[0]?.public_id || null
  );
}
async function setCurrent(c, db, ctx, req, baseline) {
  const row = (
    await c.query(
      `UPDATE "${db.schema}".reqs SET current_delivery_baseline_id=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [baseline.id, ctx.tenantId, req.id],
    )
  ).rows[0];
  Object.assign(req, row);
}
async function requirement(c, d, x, id) {
  return (
    (
      await c.query(
        'SELECT * FROM "' +
          d.schema +
          '".reqs WHERE tenant_id=$1 AND public_id=$2',
        [x.tenantId, id],
      )
    ).rows[0] || null
  );
}
async function activeRun(c, d, x, q) {
  return (
    (
      await c.query(
        `SELECT public_id FROM "${d.schema}".runs WHERE tenant_id=$1 AND req_id=$2 AND status IN ('RUNNING','CANCELLING','UNKNOWN') LIMIT 1`,
        [x.tenantId, q.id],
      )
    ).rowCount > 0
  );
}
async function referencedDev(c, d, x, q, id) {
  return (
    (
      await c.query(
        'SELECT 1 FROM ' +
          table(d, 'delivery_baselines') +
          ' WHERE tenant_id=$1 AND req_id=$2 AND dev_version_id=$3 LIMIT 1',
        [x.tenantId, q.id, id],
      )
    ).rowCount > 0
  );
}
async function confirmVersion(c, d, x, q, id) {
  return c.query(
    `UPDATE "${d.schema}".req_versions SET confirmed_by=$1,confirmed_at=now(),stale=false,review_state='通过' WHERE tenant_id=$2 AND req_id=$3 AND id=$4`,
    [x.actor, x.tenantId, q.id, id],
  );
}
async function run(c, d, x, q, id) {
  return (
    (
      await c.query(
        `SELECT r.*,p.context_snapshot,p.snapshot_version FROM "${d.schema}".runs r JOIN "${d.schema}".run_plans p ON p.tenant_id=r.tenant_id AND p.run_id=r.id WHERE r.tenant_id=$1 AND r.req_id=$2 AND r.public_id=$3`,
        [x.tenantId, q.id, id],
      )
    ).rows[0] || null
  );
}
module.exports = {
  requirement,
  activeRun,
  referencedDev,
  confirmVersion,
  run,
  table,
  insert,
  find,
  required,
  list,
  evidenceRows,
  saveRefs,
  refs,
  member,
  invalidate,
  stage,
  publicId,
  setCurrent,
};
