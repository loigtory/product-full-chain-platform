'use strict';
const access = require('../access'),
  policy = require('../domain/release-policy'),
  repo = require('./release-plans');
const kinds = [
  'plan_id',
  'result_id',
  'metric_event_id',
  'followup_event_id',
  'final_id',
];
async function check(c, d, x, q, refs, required = true) {
  const checked = policy.evidence(refs, required),
    out = [];
  let bytes = 0;
  for (const ref of checked) {
    const row = (
      await c.query(
        `SELECT m.public_id,m.name,m.allowed,m.usage,v.id version_id,v.version,f.hash,f.size,f.status FROM "${d.schema}".materials m JOIN "${d.schema}".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id LEFT JOIN "${d.schema}".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 AND m.public_id=$3 AND v.version=$4`,
        [x.tenantId, q.id, ref.id, ref.version],
      )
    ).rows[0];
    if (
      !row ||
      !row.allowed ||
      row.usage !== 'attachment' ||
      row.status !== 'READY' ||
      !row.hash
    )
      access.fail('RELEASE_EVIDENCE_UNAVAILABLE', 409, '证据不可用：' + ref.id);
    const old = refs.find((r) => r.id === ref.id && r.version === ref.version);
    if (old.hash && old.hash !== row.hash)
      access.fail('RELEASE_EVIDENCE_UNAVAILABLE', 409);
    bytes += Number(row.size);
    if (bytes > policy.limits.evidenceBytes)
      access.fail('RELEASE_LIMIT_EXCEEDED', 413);
    try {
      await require('../files/local-files').read(x.tenantId, row.hash);
    } catch {
      access.fail(
        'RELEASE_EVIDENCE_UNAVAILABLE',
        409,
        '证据原件不可读：' + ref.id,
      );
    }
    out.push(row);
  }
  return out;
}
async function save(c, d, x, q, kind, id, rows) {
  if (!kinds.includes(kind)) throw Error('INVALID_EVIDENCE_OWNER');
  for (const r of rows)
    await repo.insert(c, d, x, q, 'release_refs', {
      [kind]: id,
      material_version_id: r.version_id,
      source_data: JSON.stringify({
        id: r.public_id,
        version: r.version,
        hash: r.hash,
        size: Number(r.size),
      }),
    });
}
async function refs(c, d, x, q, kind, id) {
  if (!kinds.includes(kind)) throw Error('INVALID_EVIDENCE_OWNER');
  return (await repo.all(c, d, x, q, 'release_refs', { [kind]: id })).map(
    (r) => r.source_data,
  );
}
async function verify(c, d, x, q, kind, id, required = true) {
  const r = await refs(c, d, x, q, kind, id);
  await check(c, d, x, q, r, required);
  return r;
}
async function availability(c, d, x, q, kind, id) {
  const r = await refs(c, d, x, q, kind, id),
    out = [];
  for (const ref of r) {
    try {
      await check(c, d, x, q, [ref]);
      out.push({ ...ref, available: true });
    } catch (e) {
      if (!e.status) throw e;
      out.push({
        id: ref.id,
        version: ref.version,
        available: false,
        reason: '原件不可用或访问已撤销',
      });
    }
  }
  return out;
}
module.exports = { check, save, refs, verify, availability };
