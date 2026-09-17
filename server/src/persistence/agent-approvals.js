'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../access');
const { fingerprint } = require('./commands');
const jobs = require('./agent-jobs');
// The adapter remains disabled until pre-execution coverage is proved. These records alone never execute tools.
async function create(client, db, ctx, jobId, ownerId, request) {
  const job = await jobs.owned(client, db, jobId, ownerId);
  if (
    job.kind !== 'EXECUTE' ||
    job.input.stage !== 'dev' ||
    job.result?.cancelRequested
  )
    fail('APPROVAL_SCOPE_CHANGED');
  if (job.tenant_id !== ctx.tenantId || job.created_by !== ctx.memberId)
    fail('FORBIDDEN', 403);
  for (const key of ['requestId', 'threadId', 'turnId', 'itemId'])
    if (
      typeof request[key] !== 'string' ||
      !request[key] ||
      request[key].length > 200
    )
      fail('APPROVAL_REQUEST_INVALID', 400);
  if (
    !['command', 'fileChange'].includes(request.kind) ||
    !/^[a-f0-9]{64}$/.test(request.contextHash || '') ||
    request.contextHash !== job.input.contextHash
  )
    fail('APPROVAL_SCOPE_CHANGED');
  const requestHash = fingerprint(request),
    expires = new Date(
      Math.min(
        Date.now() + 120000,
        new Date(job.input.control.validUntil).getTime(),
      ),
    );
  if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now())
    fail('PLAN_EXPIRED');
  const prior = (
    await client.query(
      `SELECT * FROM "${db.schema}".agent_approvals WHERE job_id=$1 AND request_id=$2 FOR UPDATE`,
      [jobId, request.requestId],
    )
  ).rows[0];
  if (prior) {
    if (prior.scope_hash !== requestHash) fail('APPROVAL_REQUEST_REUSED');
    return prior;
  }
  return (
    await client.query(
      `INSERT INTO "${db.schema}".agent_approvals(id,tenant_id,req_id,job_id,request_id,thread_id,turn_id,item_id,scope_hash,request,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        randomUUID(),
        ctx.tenantId,
        job.req_id,
        jobId,
        request.requestId,
        request.threadId,
        request.turnId,
        request.itemId,
        requestHash,
        JSON.stringify(request),
        expires,
      ],
    )
  ).rows[0];
}
async function decide(client, db, ctx, req, id, input) {
  if (ctx.role !== 'owner') fail('FORBIDDEN', 403);
  const member = (
    await client.query(
      `SELECT id FROM "${db.schema}".members WHERE tenant_id=$1 AND id=$2 AND name=$3 AND active=true AND role='owner' FOR SHARE`,
      [ctx.tenantId, ctx.memberId, ctx.actor],
    )
  ).rows[0];
  if (!member) fail('FORBIDDEN', 403);
  const item = (
    await client.query(
      `SELECT a.*,j.state job_state,j.kind job_kind,j.lease_until,j.input,j.result FROM "${db.schema}".agent_approvals a JOIN "${db.schema}".agent_jobs j ON j.id=a.job_id WHERE a.tenant_id=$1 AND a.req_id=$2 AND a.id=$3 FOR UPDATE OF a,j`,
      [ctx.tenantId, req.id, id],
    )
  ).rows[0];
  if (!item) fail('NOT_FOUND', 404);
  const state =
    input.decision === 'approve'
      ? 'APPROVED'
      : input.decision === 'deny'
        ? 'DENIED'
        : null;
  if (!state) fail('INVALID_INPUT', 400);
  if (item.state !== 'PENDING') {
    if (
      item.state === state &&
      item.decided_by === ctx.memberId &&
      item.scope_hash === input.scopeHash
    )
      return item;
    fail('APPROVAL_ALREADY_DECIDED');
  }
  if (new Date(item.expires_at).getTime() <= Date.now())
    fail('APPROVAL_EXPIRED');
  if (
    item.scope_hash !== input.scopeHash ||
    item.job_kind !== 'EXECUTE' ||
    req.stage !== 'dev' ||
    item.input.stage !== 'dev' ||
    !item.lease_until ||
    new Date(item.lease_until).getTime() <= Date.now() ||
    item.input.contextHash !== input.contextHash ||
    item.result?.cancelRequested ||
    !['RUNNING', 'WAITING_APPROVAL'].includes(item.job_state)
  )
    fail('APPROVAL_SCOPE_CHANGED');
  const current = await require('../agent/context-service').stageSnapshot(
    client,
    db,
    ctx,
    req,
    item.input.stage,
  );
  if (current.hash !== item.input.contextHash) fail('AGENT_CONTEXT_CHANGED');
  require('../agent/exec-control').freezeForActor(
    { ...item.input, control: { ...item.input.control, confirmed: true } },
    ctx,
    req,
    current.hash,
  );
  return (
    await client.query(
      `UPDATE "${db.schema}".agent_approvals SET state=$1,decided_by=$2,decided_at=now() WHERE id=$3 AND state='PENDING' RETURNING *`,
      [state, ctx.memberId, id],
    )
  ).rows[0];
}
module.exports = { create, decide };
