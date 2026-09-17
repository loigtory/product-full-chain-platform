'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../access');
const { fingerprint } = require('./commands');
async function begin(client, db, job, approval, bound) {
  if (
    approval.state !== 'APPROVED' ||
    approval.job_id !== job.id ||
    approval.tenant_id !== job.tenant_id ||
    approval.req_id !== job.req_id ||
    approval.item_id !== bound.itemId ||
    new Date(approval.expires_at).getTime() <= Date.now()
  )
    fail('TOOL_APPROVAL_INVALID');
  const commandHash = fingerprint({
    tool: bound.tool,
    arguments: bound.arguments,
    callId: bound.callId,
    threadId: bound.threadId,
    turnId: bound.turnId,
  });
  const prior = (
    await client.query(
      `SELECT * FROM "${db.schema}".tool_executions WHERE job_id=$1 AND item_id=$2 FOR UPDATE`,
      [job.id, bound.itemId],
    )
  ).rows[0];
  if (prior) {
    if (prior.command_hash !== commandHash || prior.approval_id !== approval.id)
      fail('TOOL_CALL_REUSED');
    return { row: prior, replay: true };
  }
  const row = (
    await client.query(
      `INSERT INTO "${db.schema}".tool_executions(id,tenant_id,req_id,job_id,approval_id,item_id,command_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,'RUNNING') RETURNING *`,
      [
        randomUUID(),
        job.tenant_id,
        job.req_id,
        job.id,
        approval.id,
        bound.itemId,
        commandHash,
      ],
    )
  ).rows[0];
  return { row, replay: false };
}
async function finish(client, db, row, state, evidence, duration) {
  if (
    !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'].includes(
      state,
    ) ||
    !evidence ||
    !Number.isInteger(duration) ||
    duration < 0 ||
    duration > 300000
  )
    fail('TOOL_RESULT_INVALID');
  const result = (
    await client.query(
      `UPDATE "${db.schema}".tool_executions SET state=$1,exit_code=$2,duration_ms=$3,evidence=$4 WHERE id=$5 AND state='RUNNING' RETURNING *`,
      [
        state,
        state === 'SUCCEEDED' ? 0 : null,
        duration,
        JSON.stringify(evidence),
        row.id,
      ],
    )
  ).rows[0];
  if (!result) fail('TOOL_RESULT_UNVERIFIED');
  return result;
}
module.exports = { begin, finish };
