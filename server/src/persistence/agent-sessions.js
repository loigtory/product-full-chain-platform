'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../access');
async function create(client, db, ctx, req, config) {
  return (
    await client.query(
      `INSERT INTO "${db.schema}".agent_sessions(id,tenant_id,req_id,provider,model,connection_hash,created_by) VALUES($1,$2,$3,'codex',$4,$5,$6) RETURNING *`,
      [
        randomUUID(),
        ctx.tenantId,
        req.id,
        config.model,
        config.expectedConnectionFingerprint,
        ctx.memberId,
      ],
    )
  ).rows[0];
}
async function find(client, db, ctx, reqId, id) {
  const row = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_sessions WHERE tenant_id=$1 AND req_id=$2 AND id=$3`,
      [ctx.tenantId, reqId, id],
    )
  ).rows[0];
  if (!row || row.state !== 'OPEN') fail('AGENT_SESSION_UNAVAILABLE');
  return row;
}
async function bind(client, db, session, threadId) {
  const row = (
    await client.query(
      `UPDATE "${db.schema}".agent_sessions SET provider_thread_id=$1 WHERE id=$2 AND tenant_id=$3 AND req_id=$4 AND state='OPEN' AND (provider_thread_id IS NULL OR provider_thread_id=$1) RETURNING id`,
      [threadId, session.id, session.tenant_id, session.req_id],
    )
  ).rows[0];
  if (!row) fail('AGENT_SESSION_CHANGED');
}
async function startTurn(client, db, job, turnId) {
  await client.query(
    `INSERT INTO "${db.schema}".agent_turns(id,tenant_id,req_id,job_id,session_id,provider_turn_id,input_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,'RUNNING')`,
    [
      randomUUID(),
      job.tenant_id,
      job.req_id,
      job.id,
      job.session_id,
      turnId,
      job.input_hash,
    ],
  );
}
async function finishTurn(client, db, job, state, outputHash, usage) {
  await client.query(
    `UPDATE "${db.schema}".agent_turns SET state=$1,output_hash=$2,usage=$3,completed_at=now() WHERE tenant_id=$4 AND req_id=$5 AND job_id=$6 AND state='RUNNING'`,
    [
      state,
      outputHash ?? null,
      usage ? JSON.stringify(usage) : null,
      job.tenant_id,
      job.req_id,
      job.id,
    ],
  );
}
module.exports = { create, find, bind, startTurn, finishTurn };
