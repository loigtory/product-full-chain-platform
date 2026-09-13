'use strict';
// Shared bounded storage primitives for the release aggregate; no transport or policy.
const access = require('../access'),
  { allocateIdentifier } = require('./identifiers');
const names = new Set(require('./release-readiness').tables);
async function memberNamed(c, d, x, name) {
  return (
    (
      await c.query(
        `SELECT * FROM "${d.schema}".members WHERE tenant_id=$1 AND (name=$2 OR public_id=$2)`,
        [x.tenantId, name],
      )
    ).rows[0] || null
  );
}
async function requirementForPlan(c, d, x, id) {
  return (
    (
      await c.query(
        `SELECT q.public_id FROM "${d.schema}".release_plans p JOIN "${d.schema}".reqs q ON q.tenant_id=p.tenant_id AND q.id=p.req_id WHERE p.tenant_id=$1 AND p.public_id=$2`,
        [x.tenantId, id],
      )
    ).rows[0] || null
  );
}
async function materialSnapshot(c, d, x, q) {
  return (
    await c.query(
      `SELECT id,version,usage FROM "${d.schema}".materials WHERE tenant_id=$1 AND req_id=$2`,
      [x.tenantId, q.id],
    )
  ).rows;
}
async function versionStaleness(c, d, x, q) {
  return (
    await c.query(
      `SELECT id,stale FROM "${d.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2`,
      [x.tenantId, q.id],
    )
  ).rows;
}
async function restoreStaleness(c, d, x, q, versions) {
  for (const v of versions)
    await c.query(
      `UPDATE "${d.schema}".req_versions SET stale=$4 WHERE tenant_id=$1 AND req_id=$2 AND id=$3 AND stale IS DISTINCT FROM $4`,
      [x.tenantId, q.id, v.id, v.stale],
    );
}
function table(d, n) {
  if (!names.has(n)) throw Error('INVALID_RELEASE_TABLE');
  return '"' + d.schema + '"."' + n + '"';
}
async function insert(c, d, x, q, n, fields) {
  const id = await allocateIdentifier(c, d, x.tenantId, n),
    v = {
      id: id.id,
      tenant_id: x.tenantId,
      req_id: q.id,
      public_id: id.publicId,
      created_by: x.memberId,
      created_name: (
        await require('./verification-baselines').member(c, d, x, x.memberId)
      ).name,
      ...fields,
    };
  const keys = Object.keys(v);
  if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw Error('INVALID_COLUMN');
  return (
    await c.query(
      `INSERT INTO ${table(d, n)}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      Object.values(v),
    )
  ).rows[0];
}
async function find(c, d, x, q, n, id, internal = false) {
  return (
    (
      await c.query(
        `SELECT * FROM ${table(d, n)} WHERE tenant_id=$1 AND req_id=$2 AND ${internal ? 'id' : 'public_id'}=$3`,
        [x.tenantId, q.id, id],
      )
    ).rows[0] || null
  );
}
async function required(...a) {
  const row = await find(...a);
  if (!row) access.fail('NOT_FOUND', 404);
  return row;
}
async function all(c, d, x, q, n, filter = {}) {
  const keys = Object.keys(filter);
  if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw Error('INVALID_COLUMN');
  return (
    await c.query(
      `SELECT * FROM ${table(d, n)} WHERE tenant_id=$1 AND req_id=$2 ${keys.map((k, i) => 'AND ' + k + '=$' + (i + 3)).join(' ')} ORDER BY created_at DESC,public_id DESC LIMIT 2001`,
      [x.tenantId, q.id, ...Object.values(filter)],
    )
  ).rows;
}
async function page(c, d, x, q, n, query = {}, filter = {}) {
  const { limit, offset } = access.page(query),
    keys = Object.keys(filter);
  if (keys.some((k) => !/^[a-z_]+$/.test(k))) throw Error('INVALID_COLUMN');
  const where = `tenant_id=$1 AND req_id=$2 ${query.submittedOnly && n === 'release_plans' ? "AND review_state<>'NOT_SUBMITTED'" : ''} ${keys.map((k, i) => 'AND ' + k + '=$' + (i + 3)).join(' ')}`,
    args = [x.tenantId, q.id, ...Object.values(filter)],
    total = Number(
      (
        await c.query(
          `SELECT count(*) n FROM ${table(d, n)} WHERE ${where}`,
          args,
        )
      ).rows[0].n,
    ),
    rows = (
      await c.query(
        `SELECT * FROM ${table(d, n)} WHERE ${where} ORDER BY created_at DESC,public_id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, offset],
      )
    ).rows;
  return {
    items: rows,
    total,
    limit,
    offset,
  };
}
async function bound(c, d, x, q, n, max, filter = {}) {
  if ((await all(c, d, x, q, n, filter)).length >= max)
    access.fail('RELEASE_LIMIT_EXCEEDED', 413, '记录数达到上限');
}
async function pointers(c, d, x, q, fields) {
  const allowed = [
    'current_release_plan_id',
    'current_release_id',
    'current_observation_id',
    'release_epoch',
    'stage',
    'closed_at',
  ];
  const keys = Object.keys(fields);
  if (keys.some((k) => !allowed.includes(k)))
    throw Error('INVALID_RELEASE_POINTER');
  Object.assign(
    q,
    (
      await c.query(
        `UPDATE "${d.schema}".reqs SET ${keys.map((k, i) => k + '=$' + (i + 3)).join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [x.tenantId, q.id, ...Object.values(fields)],
      )
    ).rows[0],
  );
}
async function reviewState(c, d, x, q, p, state, extra = {}) {
  const keys = Object.keys(extra);
  if (keys.some((k) => !['submitted_at', 'expires_at'].includes(k)))
    throw Error('INVALID_RELEASE_HEADER');
  Object.assign(
    p,
    (
      await c.query(
        `UPDATE ${table(d, 'release_plans')} SET review_state=$4 ${keys.map((k, i) => ',' + k + '=$' + (i + 5)).join('')} WHERE tenant_id=$1 AND req_id=$2 AND id=$3 RETURNING *`,
        [x.tenantId, q.id, p.id, state, ...Object.values(extra)],
      )
    ).rows[0],
  );
}
module.exports = {
  memberNamed,
  requirementForPlan,
  materialSnapshot,
  versionStaleness,
  restoreStaleness,
  table,
  insert,
  find,
  required,
  all,
  page,
  bound,
  pointers,
  reviewState,
};
