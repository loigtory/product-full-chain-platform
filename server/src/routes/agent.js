'use strict';
const express = require('express');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const budget = require('../agent/budget');
const router = express.Router();

const AUTHORIZATION_PATH = path.resolve(
  __dirname,
  '../../..',
  'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
);

function authorizationState() {
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED')
      return {
        status: 'USER_CONFIRMED',
        sourceBytes: auth.source?.bytes ?? null,
      };
    return { status: auth?.status || 'NOT_CONFIRMED' };
  } catch {
    return { status: 'NOT_FOUND' };
  }
}

function approvedSources() {
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED' && auth?.source) return [auth.source];
  } catch {
    /* 无已确认指令源 */
  }
  return [];
}

// 非敏感连接状态；不返回二进制路径、token 或连接串。
router.get('/status', (req, res) => {
  let schemaVersion;
  try {
    schemaVersion = require('../runtime').db()?.targetVersion || null;
  } catch {
    schemaVersion = null;
  }
  const capable = !!process.env.PFC_CODEX_BINARY && schemaVersion === '007';
  const execution = require('../agent/execution-policy').capability();
  res.json({
    mode: 'real',
    provider: 'codex',
    expectedVersion: '0.154.0',
    configured: !!process.env.PFC_CODEX_BINARY,
    binary: !!process.env.PFC_CODEX_BINARY,
    cwdConfigured: !!process.env.PFC_CODEX_PREFLIGHT_CWD,
    connectionFingerprintSet: !!process.env.PFC_CODEX_CONNECTION_SHA256,
    authorization: authorizationState(),
    schemaVersion,
    // exec 工具入口能力：真实 agent 连接 + agent_jobs schema（007）就绪。
    // 前端据此决定是否展示"开发执行"入口（006 环境不展示，避免无效作业）。
    execCapable: capable && execution.supported,
    execution,
    capable,
    budget: budget.snapshot(),
  });
});

// Report actual enabled capabilities; the stage catalog describes future candidates.
router.get('/stage-capabilities', (req, res) => {
  const caps = require('../agent/stage-capabilities');
  res.json({
    stages: caps.all().map((stage) => ({
      ...stage,
      skills: [],
      tools: ['文本对话'],
      mcps: [],
      execution: 'BLOCKED',
      configuredCandidates: stage.skills,
    })),
  });
});

// 只读预检：验证 CLI 版本、账号模式、连接指纹与隔离配置；不发起模型生成。
router.post('/preflight', async (req, res, next) => {
  try {
    const binary = process.env.PFC_CODEX_BINARY;
    if (!binary)
      return res
        .status(409)
        .json({ ok: false, code: 'CONNECTION_UNAVAILABLE' });
    const { preflight } = await import('../agent/protocol.mjs');
    const result = await preflight({
      binary,
      expectedSha256: process.env.PFC_CODEX_BINARY_SHA256 || undefined,
      cwd: process.env.PFC_CODEX_PREFLIGHT_CWD,
      expectedConnectionFingerprint:
        process.env.PFC_CODEX_CONNECTION_SHA256 || undefined,
      approvedInstructionSources: approvedSources(),
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/jobs/:jobId/approvals/:approvalId/decision',
  async (req, res, next) => {
    try {
      const access = require('../access'),
        ctx = access.current(true),
        db = require('../runtime').db();
      if (ctx.role !== 'owner') access.fail('FORBIDDEN', 403);
      const input = req.body || {};
      if (
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          req.params.jobId,
        ) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          req.params.approvalId,
        ) ||
        Object.keys(input).some(
          (key) =>
            !['decision', 'scopeHash', 'expectedState', 'commandId'].includes(
              key,
            ),
        ) ||
        input.expectedState !== 'PENDING' ||
        !['approve', 'deny'].includes(input.decision) ||
        !/^[a-f0-9]{64}$/.test(input.scopeHash || '')
      )
        access.fail('INVALID_INPUT', 400);
      const result = await require('../persistence/commands').command(
        db,
        ctx,
        'agentApproval:' + req.params.jobId + ':' + req.params.approvalId,
        input,
        async (client) => {
          if (ctx.role !== 'owner') access.fail('FORBIDDEN', 403);
          const job = (
            await client.query(
              'SELECT j.req_id,j.input FROM "' +
                db.schema +
                '".agent_jobs j JOIN "' +
                db.schema +
                '".agent_approvals a ON a.job_id=j.id WHERE j.tenant_id=$1 AND j.id=$2 AND a.id=$3',
              [ctx.tenantId, req.params.jobId, req.params.approvalId],
            )
          ).rows[0];
          if (!job) access.fail('NOT_FOUND', 404);
          const row = (
            await client.query(
              'SELECT * FROM "' +
                db.schema +
                '".reqs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
              [ctx.tenantId, job.req_id],
            )
          ).rows[0];
          const approval =
            await require('../persistence/agent-approvals').decide(
              client,
              db,
              ctx,
              row,
              req.params.approvalId,
              { ...input, contextHash: job.input.contextHash },
            );
          return {
            approval: {
              id: approval.id,
              state: approval.state,
              scopeHash: approval.scope_hash,
              decidedAt: approval.decided_at,
            },
          };
        },
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);
module.exports = router;
