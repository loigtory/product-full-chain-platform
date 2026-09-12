'use strict';
const { randomUUID } = require('node:crypto');
const access = require('../access'),
  runtime = require('../runtime'),
  policy = require('./membership-policy'),
  repo = require('../persistence/governance-read');
const { governanceAudit } = require('../persistence/commands');
function query(input) {
  return {
    ...access.page(input),
    actor: input.actor ? access.text(input.actor, 160, true) : null,
    action: input.action ? access.text(input.action, 160, true) : null,
  };
}
function csvCell(value) {
  let s = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[\s]*[=+@\-\t\r]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function exportCsv(rows) {
  if (rows.length > 10000)
    access.fail('EXPORT_LIMIT_EXCEEDED', 409, '请缩小审计筛选范围');
  const fields = [
    'id',
    'time',
    'actor',
    'action',
    'entityType',
    'entityId',
    'detail',
  ];
  const csv =
    '\uFEFF' +
    [
      fields.map(csvCell).join(','),
      ...rows.map((r) => fields.map((k) => csvCell(r[k])).join(',')),
    ].join('\r\n') +
    '\r\n';
  if (Buffer.byteLength(csv) > 5 * 1024 * 1024)
    access.fail('EXPORT_LIMIT_EXCEEDED', 409, '请缩小审计筛选范围');
  return csv;
}
async function audit(input = {}) {
  const ctx = access.current(),
    db = runtime.db(),
    q = query(input);
  return policy.read(db, ctx, true, async (c) => ({
    items: await repo.audit(c, db, ctx, q),
    total: await repo.count(c, db, ctx, q),
    limit: q.limit,
    offset: q.offset,
  }));
}
async function exportAudit(input = {}) {
  const ctx = access.current(),
    db = runtime.db(),
    q = query(input),
    requestId = randomUUID();
  return policy.read(db, ctx, true, async (c) => {
    const snapshotAt = new Date().toISOString(),
      rows = await repo.audit(c, db, ctx, { ...q, limit: 10001, offset: 0 });
    if (rows.length > 10000)
      access.fail('EXPORT_LIMIT_EXCEEDED', 409, '请缩小审计筛选范围');
    const csv = exportCsv(rows);
    await governanceAudit(
      c,
      db,
      ctx,
      'audit',
      requestId,
      'audit.export',
      JSON.stringify({
        requestId,
        filter: { actor: q.actor, action: q.action },
        count: rows.length,
        snapshotAt,
        outcome: 'response-prepared',
      }),
    );
    return { csv, count: rows.length, snapshotAt, requestId };
  });
}
async function budget() {
  const ctx = access.current(),
    db = runtime.db(),
    period = new Date().toISOString().slice(0, 7);
  return policy.read(db, ctx, false, async (c) => {
    const r = await repo.budget(c, db, ctx, period);
    if (r && ![r.quota, r.used].every((v) => Number.isSafeInteger(Number(v))))
      access.fail(
        'BUDGET_RANGE_UNSUPPORTED',
        409,
        '预算数值超出可精确显示的范围，请核对配置',
      );
    return {
      budget: r
        ? {
            configured: true,
            period,
            quota: Number(r.quota),
            used: Number(r.used),
            remaining: Number(r.quota) - Number(r.used),
            source: r.source,
            revision: r.revision,
          }
        : {
            configured: false,
            period,
            quota: null,
            used: null,
            remaining: null,
            source: 'unconfigured',
          },
    };
  });
}
module.exports = { audit, exportAudit, budget, csvCell, exportCsv };
