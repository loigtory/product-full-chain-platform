'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../access');
const tables = [
  'agent_sessions',
  'agent_turns',
  'agent_jobs',
  'agent_events',
  'agent_approvals',
  'material_extractions',
  'material_segments',
  'project_scans',
  'tool_executions',
  'runner_evidence',
];
async function assertReady(db, client = db.pool) {
  const constraints = (
    await client.query(
      'SELECT c.relname,k.contype,k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1',
      [db.schema],
    )
  ).rows;
  for (const table of tables)
    for (const type of ['p', 'f'])
      if (
        !constraints.some(
          (r) => r.relname === table && r.contype === type && r.convalidated,
        )
      )
        fail('MIGRATION_NOT_READY', 503);
  const triggers = (
    await client.query(
      'SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal',
      [db.schema],
    )
  ).rows;
  for (const name of [
    'agent_jobs_guard',
    'agent_events_immutable',
    'material_extractions_immutable',
    'material_segments_immutable',
    'project_scans_immutable',
    'runner_evidence_immutable',
    'material_extraction_owner',
  ])
    if (!triggers.some((t) => t.tgname === name && t.tgenabled === 'O'))
      fail('MIGRATION_NOT_READY', 503);
}
async function enqueue(client, db, ctx, req, input) {
  if (!['007', '008', '009', '010', '011', '012'].includes(db.targetVersion)) fail('AGENT_SCHEMA_REQUIRED', 503);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    ctx.tenantId + ':agent:' + req.id + ':' + input.commandId,
  ]);
  const prior = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND command_id=$3 FOR UPDATE`,
      [ctx.tenantId, req.id, input.commandId],
    )
  ).rows[0];
  if (prior) {
    if (
      prior.input_hash !== input.inputHash ||
      prior.kind !== input.kind ||
      prior.session_id !== (input.sessionId ?? null)
    )
      fail('COMMAND_REUSED');
    return prior;
  }
  const id = randomUUID();
  const job = (
    await client.query(
      `INSERT INTO "${db.schema}".agent_jobs(id,tenant_id,req_id,session_id,command_id,kind,input_hash,input,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        ctx.tenantId,
        req.id,
        input.sessionId ?? null,
        input.commandId,
        input.kind,
        input.inputHash,
        JSON.stringify(input.input),
        ctx.memberId,
      ],
    )
  ).rows[0];
  await require('./agent-events').append(client, db, job, 'queued', {});
  return job;
}
async function claim(client, db, ownerId) {
  const job = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE state='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
    )
  ).rows[0];
  if (!job) return null;
  const row = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state='RUNNING',owner_id=$1,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$2 RETURNING *`,
      [ownerId, job.id],
    )
  ).rows[0];
  await require('./agent-events').append(client, db, row, 'started', {});
  return row;
}
async function claimById(client, db, id, ownerId) {
  const row = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state='RUNNING',owner_id=$1,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$2 AND state='QUEUED' RETURNING *`,
      [ownerId, id],
    )
  ).rows[0];
  if (!row) fail('AGENT_JOB_NOT_QUEUED');
  await require('./agent-events').append(client, db, row, 'started', {});
  return row;
}
async function owned(client, db, id, ownerId) {
  const job = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE id=$1 AND owner_id=$2 AND lease_until>now() AND state IN ('RUNNING','WAITING_APPROVAL') FOR UPDATE`,
      [id, ownerId],
    )
  ).rows[0];
  if (!job) fail('AGENT_LEASE_LOST');
  return job;
}
async function dispatch(client, db, id, ownerId) {
  const job = await owned(client, db, id, ownerId);
  if (job.result?.cancelRequested) fail('TURN_CANCELLED');
  if (job.dispatched_at) fail('AGENT_REPLAY_FORBIDDEN');
  return (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET dispatched_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
      [id],
    )
  ).rows[0];
}
async function heartbeat(client, db, id, ownerId) {
  await owned(client, db, id, ownerId);
  await client.query(
    `UPDATE "${db.schema}".agent_jobs SET lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1`,
    [id],
  );
}
async function finish(
  client,
  db,
  id,
  ownerId,
  state,
  result = null,
  code = null,
) {
  if (
    !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'].includes(
      state,
    )
  )
    fail('AGENT_STATE_INVALID');
  const job = await owned(client, db, id, ownerId);
  if (state === 'SUCCEEDED' && job.result?.cancelRequested)
    fail('TURN_CANCELLED');
  if (state === 'SUCCEEDED' && !job.dispatched_at)
    fail('AGENT_RESULT_UNVERIFIED');
  const row = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state=$1,result=$2,error_code=$3,updated_at=now() WHERE id=$4 RETURNING *`,
      [state, result && JSON.stringify(result), code, id],
    )
  ).rows[0];
  await require('./agent-events').append(
    client,
    db,
    row,
    {
      SUCCEEDED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      TIMED_OUT: 'timed_out',
      UNKNOWN: 'unknown',
    }[state],
    { state, ...(code ? { code } : {}) },
  );
  return row;
}
// A failed worker may only mark its own expired, still-active lease UNKNOWN.
// It cannot overwrite another worker or promote an unverifiable result to success.
async function forceFinish(
  client,
  db,
  id,
  state,
  result = null,
  code = null,
  ownerId,
) {
  if (state !== 'UNKNOWN' || !ownerId) fail('AGENT_RESULT_UNVERIFIED');
  const row = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state=$1,result=$2,error_code=$3,updated_at=now() WHERE id=$4 AND owner_id=$5 AND state IN ('RUNNING','WAITING_APPROVAL') AND lease_until<=now() RETURNING *`,
      [state, result && JSON.stringify(result), code, id, ownerId],
    )
  ).rows[0];
  if (!row) return null;
  await require('./agent-events').append(
    client,
    db,
    row,
    {
      SUCCEEDED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      TIMED_OUT: 'timed_out',
      UNKNOWN: 'unknown',
    }[state],
    { state, ...(code ? { code } : {}) },
  );
  return row;
}
async function requestCancel(client, db, ctx, reqId, id) {
  const job = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND id=$3 FOR UPDATE`,
      [ctx.tenantId, reqId, id],
    )
  ).rows[0];
  if (!job) fail('AGENT_JOB_NOT_FOUND', 404);
  if (
    !['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(job.state) ||
    job.result?.cancelRequested
  )
    return job;
  const queued = job.state === 'QUEUED';
  const updated = (
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state=$1,result=$2,updated_at=now() WHERE id=$3 RETURNING *`,
      [
        queued ? 'CANCELLED' : job.state,
        JSON.stringify({ ...job.result, cancelRequested: true }),
        id,
      ],
    )
  ).rows[0];
  if (queued)
    await require('./agent-events').append(client, db, updated, 'cancelled', {
      state: 'CANCELLED',
      reason: 'USER_REQUEST',
    });
  return updated;
}
async function recover(client, db, expiredOwner = null) {
  const rows = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE state IN ('RUNNING','WAITING_APPROVAL') AND (lease_until<=now() OR owner_id=$1) FOR UPDATE`,
      [expiredOwner],
    )
  ).rows;
  for (const job of rows) {
    await client.query(
      `UPDATE "${db.schema}".tool_executions SET state='UNKNOWN',evidence=COALESCE(evidence,'{}'::jsonb) || $2::jsonb WHERE job_id=$1 AND state='RUNNING'`,
      [job.id, JSON.stringify({ code: 'WORKER_LOST_EFFECT_UNCONFIRMED' })],
    );
    await client.query(
      `UPDATE "${db.schema}".agent_approvals SET state='EXPIRED',decided_at=now() WHERE job_id=$1 AND state='PENDING'`,
      [job.id],
    );
    const state = job.dispatched_at
      ? 'UNKNOWN'
      : job.result?.cancelRequested
        ? 'CANCELLED'
        : 'QUEUED';
    await client.query(
      `UPDATE "${db.schema}".agent_jobs SET state=$1,owner_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$2`,
      [state, job.id],
    );
    await require('./agent-events').append(
      client,
      db,
      job,
      state === 'UNKNOWN'
        ? 'unknown'
        : state === 'CANCELLED'
          ? 'cancelled'
          : 'queued',
      { reason: 'WORKER_LOST' },
    );
  }
  return rows.map((r) => ({
    id: r.id,
    state: r.dispatched_at
      ? 'UNKNOWN'
      : r.result?.cancelRequested
        ? 'CANCELLED'
        : 'QUEUED',
  }));
}
async function find(client, db, ctx, reqId, id) {
  return (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND id=$3`,
      [ctx.tenantId, reqId, id],
    )
  ).rows[0];
}
module.exports = {
  bindToolTurn,
  tables,
  assertReady,
  enqueue,
  claim,
  claimById,
  owned,
  dispatch,
  heartbeat,
  finish,
  forceFinish,
  recover,
  find,
  requestCancel,
};

async function bindToolTurn(client, db, job, threadId, turnId) {
  if (
    job.result?.toolThreadId &&
    (job.result.toolThreadId !== threadId || job.result.toolTurnId !== turnId)
  )
    fail('TOOL_IDENTITY_MISMATCH');
  if (job.result?.toolThreadId) return;
  await client.query(
    `UPDATE "${db.schema}".agent_jobs SET result=COALESCE(result,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ toolThreadId: threadId, toolTurnId: turnId }), job.id],
  );
}
