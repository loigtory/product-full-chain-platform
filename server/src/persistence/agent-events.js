'use strict';
const { fail } = require('../access');
async function append(client, db, job, type, payload) {
  const n = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET next_sequence=next_sequence+1 WHERE id=$1 AND tenant_id=$2 AND req_id=$3 RETURNING next_sequence`,
      [job.id, job.tenant_id, job.req_id],
    )
  ).rows[0]?.next_sequence;
  if (!n) fail('AGENT_JOB_NOT_FOUND', 404);
  await client.query(
    `INSERT INTO "${db.schema}".agent_events(tenant_id,req_id,job_id,sequence,type,payload) VALUES($1,$2,$3,$4,$5,$6)`,
    [job.tenant_id, job.req_id, job.id, n, type, JSON.stringify(payload)],
  );
  return n;
}
async function list(client, db, ctx, reqId, jobId, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0 || after > 10000)
    fail('INVALID_CURSOR', 400);
  return (
    await client.query(
      `SELECT sequence,type,payload,created_at FROM "${db.schema}".agent_events WHERE tenant_id=$1 AND req_id=$2 AND job_id=$3 AND sequence>$4 ORDER BY sequence LIMIT 100`,
      [ctx.tenantId, reqId, jobId, after],
    )
  ).rows;
}
module.exports = { append, list };
