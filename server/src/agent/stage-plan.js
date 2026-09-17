'use strict';
// 52 号：阶段基线冻结 / 撤权复核。
// 阶段计划是 owner 确认的阶段级执行契约（工作区 + 允许文件/命令 + 限额 + 有效期）；
// 执行时由 job.input.control 派生（turn 级仍走 exec-control.validatePlan）。
const { createHash } = require('node:crypto');
const { withTransaction } = require('../persistence/transaction');
const access = require('../access');
const {
  checkedWorkspace,
  scanWorkspace,
  baselineHash,
  reviewDiff,
} = require('./exec-control');

const STAGES = ['idea', 'req', 'design', 'dev', 'test', 'accept', 'release'];
const MAX_PLAN_MS = 7 * 24 * 3600 * 1000; // 阶段级有效期上限 7 天

const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};

function sanitizeControl(control) {
  if (!control || typeof control !== 'object') fail('PLAN_INVALID', 400);
  const mode = control.mode;
  if (mode !== 'strict' && mode !== 'readonly') fail('PLAN_INVALID_MODE', 400);
  const allowedFiles = Array.isArray(control.allowedFiles)
    ? control.allowedFiles.map(String)
    : [];
  if (mode === 'strict' && allowedFiles.length === 0)
    fail('PLAN_NO_ALLOWED_FILES', 400);
  const allowedCommands = Array.isArray(control.allowedCommands)
    ? control.allowedCommands
    : [];
  for (const cmd of allowedCommands)
    if (
      !Array.isArray(cmd) ||
      !cmd.length ||
      cmd.some((arg) => typeof arg !== 'string' || /[\r\n\0]/.test(arg))
    )
      fail('PLAN_COMMAND_INVALID', 400);
  const maxFiles = Number.isSafeInteger(control.maxFiles)
    ? control.maxFiles
    : 50;
  const maxBytes = Number.isSafeInteger(control.maxBytes)
    ? control.maxBytes
    : 2097152;
  if (maxFiles < 1 || maxFiles > 50) fail('PLAN_LIMIT_INVALID', 400);
  if (maxBytes < 1 || maxBytes > 5242880) fail('PLAN_LIMIT_INVALID', 400);
  const validUntil = control.validUntil;
  const until = new Date(validUntil).getTime();
  if (!Number.isFinite(until)) fail('PLAN_INVALID_UNTIL', 400);
  if (until <= Date.now()) fail('PLAN_EXPIRED', 400);
  if (until > Date.now() + MAX_PLAN_MS) fail('PLAN_INVALID_UNTIL', 400);
  for (const pattern of [...allowedFiles, ...(control.forbidden || [])])
    if (
      !pattern ||
      /^[a-z]:[\\/]/i.test(pattern) ||
      pattern.split(/[\\/]/).includes('..') ||
      Array.from(pattern).some(
        (char) => char.charCodeAt(0) < 32 || char === ':',
      )
    )
      fail('PLAN_INVALID_PATH', 400);
  return {
    mode,
    allowedFiles,
    allowedCommands,
    forbidden: Array.isArray(control.forbidden) ? control.forbidden : [],
    maxFiles,
    maxBytes,
    validUntil,
  };
}

async function freeze(db, ctx, req, { stage, workspace, control }) {
  if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
  if (!STAGES.includes(stage) || stage !== req.stage)
    fail('STAGE_MISMATCH', 409);
  const root = checkedWorkspace(workspace);
  const entries = scanWorkspace(root);
  const baseline = baselineHash(entries);
  const snapshot = {};
  for (const [rel, v] of entries) snapshot[rel] = { size: v.size, sha256: v.sha256 };
  const plan = sanitizeControl(control);
  const contextHash = await withTransaction(db, async (client) => {
    const current = await require('./context-service').stageSnapshot(
      client,
      db,
      ctx,
      req,
      stage,
    );
    return current.hash;
  });
  const frozen = {
    ...plan,
    approvalSource: 'SERVER_AUTHENTICATED',
    approvedBy: ctx.memberId,
    tenantId: ctx.tenantId,
    reqId: req.id,
    contextHash,
    baselineHash: baseline,
    frozenAt: new Date().toISOString(),
  };
  await withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stagePlan.freeze',
    );
    await client.query(
      `INSERT INTO "${db.schema}".stage_plans
        (id,tenant_id,req_id,stage,workspace,control,baseline_hash,baseline_snapshot,state,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'frozen',$9)
       ON CONFLICT (tenant_id,req_id,stage) DO UPDATE SET
        workspace=EXCLUDED.workspace,control=EXCLUDED.control,
        baseline_hash=EXCLUDED.baseline_hash,baseline_snapshot=EXCLUDED.baseline_snapshot,
        state='frozen',review=NULL,revoked_by=NULL,revoked_at=NULL,created_at=now()`,
      [
        require('node:crypto').randomUUID(),
        ctx.tenantId,
        req.id,
        stage,
        root,
        JSON.stringify(frozen),
        baseline,
        JSON.stringify(snapshot),
        ctx.memberId,
      ],
    );
  });
  return {
    stage,
    state: 'frozen',
    workspace: root,
    baselineHash: baseline,
    fileCount: entries.size,
    control: {
      mode: frozen.mode,
      allowedFiles: frozen.allowedFiles,
      allowedCommands: frozen.allowedCommands,
      forbidden: frozen.forbidden,
      maxFiles: frozen.maxFiles,
      maxBytes: frozen.maxBytes,
      validUntil: frozen.validUntil,
    },
    createdAt: new Date().toISOString(),
  };
}

async function get(db, ctx, req, stage) {
  if (!STAGES.includes(stage)) fail('STAGE_INVALID', 400);
  const row = await withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stagePlan.read',
    );
    return (
      await client.query(
        `SELECT * FROM "${db.schema}".stage_plans WHERE tenant_id=$1 AND req_id=$2 AND stage=$3`,
        [ctx.tenantId, req.id, stage],
      )
    ).rows[0];
  });
  if (!row) return { stage, state: 'none' };
  return {
    stage,
    state: row.state,
    workspace: row.workspace,
    baselineHash: row.baseline_hash,
    fileCount: Object.keys(row.baseline_snapshot || {}).length,
    control: row.control
      ? {
          mode: row.control.mode,
          allowedFiles: row.control.allowedFiles,
          allowedCommands: row.control.allowedCommands,
          forbidden: row.control.forbidden,
          maxFiles: row.control.maxFiles,
          maxBytes: row.control.maxBytes,
          validUntil: row.control.validUntil,
        }
      : null,
    review: row.review || null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

async function review(db, ctx, req, stage) {
  if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
  if (!STAGES.includes(stage)) fail('STAGE_INVALID', 400);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stagePlan.review',
    );
    const row = (
      await client.query(
        `SELECT * FROM "${db.schema}".stage_plans WHERE tenant_id=$1 AND req_id=$2 AND stage=$3 FOR UPDATE`,
        [ctx.tenantId, req.id, stage],
      )
    ).rows[0];
    if (!row || row.state !== 'frozen') fail('PLAN_NOT_FROZEN', 409);
    const before = new Map();
    for (const [rel, v] of Object.entries(row.baseline_snapshot || {}))
      before.set(rel, { size: v.size, sha256: v.sha256, content: null });
    const root = checkedWorkspace(row.workspace);
    const current = scanWorkspace(root);
    const diff = reviewDiff(row.control, root, before);
    const payload = {
      ...diff,
      currentFileCount: current.size,
      reviewedAt: new Date().toISOString(),
    };
    await client.query(
      `UPDATE "${db.schema}".stage_plans SET review=$1 WHERE tenant_id=$2 AND req_id=$3 AND stage=$4`,
      [JSON.stringify(payload), ctx.tenantId, req.id, stage],
    );
    return { stage, ...payload };
  });
}

async function revoke(db, ctx, req, stage) {
  if (ctx.role !== 'owner' || !ctx.memberId) fail('FORBIDDEN', 403);
  if (!STAGES.includes(stage)) fail('STAGE_INVALID', 400);
  return withTransaction(db, async (client) => {
    await require('../domain/membership-policy').authorizeCommand(
      client,
      db,
      ctx,
      'stagePlan.revoke',
    );
    const row = (
      await client.query(
        `SELECT * FROM "${db.schema}".stage_plans WHERE tenant_id=$1 AND req_id=$2 AND stage=$3 FOR UPDATE`,
        [ctx.tenantId, req.id, stage],
      )
    ).rows[0];
    if (!row || row.state !== 'frozen') fail('PLAN_NOT_FROZEN', 409);
    if (!row.review) fail('STAGE_REVIEW_REQUIRED', 409);
    if (row.review.violates) fail('STAGE_REVIEW_VIOLATIONS', 409);
    await client.query(
      `UPDATE "${db.schema}".stage_plans SET state='revoked',revoked_by=$1,revoked_at=now()
       WHERE tenant_id=$2 AND req_id=$3 AND stage=$4`,
      [ctx.memberId, ctx.tenantId, req.id, stage],
    );
    return { stage, state: 'revoked', revokedAt: new Date().toISOString() };
  });
}

module.exports = { freeze, get, review, revoke, STAGES, sanitizeControl };
