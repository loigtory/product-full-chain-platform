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
  const capable = !!process.env.PFC_CODEX_BINARY && ['007', '008'].includes(schemaVersion);
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

// 63 号：EXEC 作业命令级输出流（owner 专属；jobId 须存在于 agent_jobs）
router.get('/exec-stream', async (req, res, next) => {
  try {
    const ctx = require('../access').current();
    if (ctx.role !== 'owner') require('../access').fail('FORBIDDEN', 403);
    const jobId = String(req.query.jobId || '');
    const store = require('../agent/exec-stream-store');
    const db = require('../runtime').db();
    const hit = await db.pool.query(
      'SELECT 1 FROM "' + db.schema + '".agent_jobs WHERE id=$1',
      [jobId],
    );
    if (!hit.rowCount) {
      res.status(404).json({ error: { code: 'EXEC_STREAM_NOT_FOUND' } });
      return;
    }
    res.json(store.read(jobId));
  } catch (e) {
    next(e);
  }
});

// 63 号：EXEC 作业命令级输出流（owner 专属；jobId 须存在于 agent_jobs）
router.get('/requirements/:reqId/exec-stream', async (req, res, next) => {
  try {
    const ctx = require('../access').current();
    if (ctx.role !== 'owner') require('../access').fail('FORBIDDEN', 403);
    const jobId = String(req.query.jobId || '');
    const store = require('../agent/exec-stream-store');
    const db = require('../runtime').db();
    const hit = await db.pool.query(
      'SELECT 1 FROM "' + db.schema + '".agent_jobs WHERE id=$1',
      [jobId],
    );
    if (!hit.rowCount) {
      res.status(404).json({ error: { code: 'EXEC_STREAM_NOT_FOUND' } });
      return;
    }
    res.json(store.read(jobId));
  } catch (e) {
    next(e);
  }
});

// 64 号：设计阶段产物（方案设计/时序图/流程图/可交互原型）读取
router.get('/requirements/:reqId/design-artifacts', async (req, res, next) => {
  try {
    const ctx = require('../access').current();
    const db = require('../runtime').db();
    const svc = require('../domain/design-artifact-service');
    res.json(await svc.listForReq(db, ctx, req.params.reqId));
  } catch (e) {
    next(e);
  }
});

// 62 号：预算/资源耗用报表（owner 专属；两个账本为唯一事实源，汇总现算不缓存）
//  remediation 账本（active 预算）+ host-exec 账本（EXEC 真实作业预算，上限 80）
router.get('/budget', async (req, res, next) => {
  try {
    const ctx = require('../access').current();
    if (ctx.role !== 'owner') require('../access').fail('FORBIDDEN', 403);
    const fs = require('node:fs');
    function summarize(snap, ledgerPath) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const byStatus = {};
      const byDay = {};
      const byStage = {};
      let seconds = 0;
      for (const a of ledger.attempts) {
        const sec = a.status === 'DISPATCHING' ? a.reservedSeconds : a.actualSeconds;
        seconds += sec;
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        const day = String(a.createdAt || '').slice(0, 10);
        if (day) {
          byDay[day] = byDay[day] || { turns: 0, seconds: 0 };
          byDay[day].turns += 1;
          byDay[day].seconds += sec;
        }
        const stage = a.details?.stage || 'unknown';
        byStage[stage] = byStage[stage] || { turns: 0, seconds: 0 };
        byStage[stage].turns += 1;
        byStage[stage].seconds += sec;
      }
      return {
        packageId: snap.packageId,
        limits: { maxTurns: snap.maxTurns, maxSeconds: snap.maxSeconds },
        usage: { turns: snap.turns, seconds, remainingTurns: snap.remaining },
        byStatus,
        byDay: Object.keys(byDay).sort().map((d) => ({ date: d, ...byDay[d] })),
        byStage: Object.entries(byStage)
          .map(([stage, v]) => ({ stage, ...v }))
          .sort((x, y) => y.seconds - x.seconds),
        recent: [...ledger.attempts]
          .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
          .slice(0, 30)
          .map((a) => ({
            attemptId: String(a.attemptId).slice(0, 8) + '…',
            status: a.status,
            stage: a.details?.stage || null,
            tool: a.details?.tool || null,
            jobId: a.details?.jobId || null,
            seconds: a.status === 'DISPATCHING' ? a.reservedSeconds : a.actualSeconds,
            createdAt: a.createdAt,
          })),
      };
    }
    const active = summarize(budget.snapshot(), budget.LEDGER);
    const exec = summarize(budget.hostBudget().snapshot(), budget.HOST_LEDGER);
    res.json({
      ledgers: {
        remediation: active,
        exec: exec,
      },
      overall: {
        turns: active.usage.turns + exec.usage.turns,
        seconds: active.usage.seconds + exec.usage.seconds,
        remainingExecTurns: exec.usage.remainingTurns,
      },
      source: 'ledger',
    });
  } catch (e) {
    next(e);
  }
});
// 阶段能力配置中心（55 号）：静态声明（goal/guide）+ 配置表（stage_capabilities 热插拔）。
// 返回 8 阶段实际启用能力（skill/tool/mcp 的 enabled/source/priority 来自配置表，页面可改）。
router.get('/stage-capabilities', async (req, res, next) => {
  try {
    const db = require('../runtime').db();
    const ctx = require('../access').current();
    const rows = await require('../agent/stage-capabilities-config').list(db, ctx);
    const byStage = new Map();
    for (const row of rows) {
      if (!byStage.has(row.stage))
        byStage.set(row.stage, { skills: [], tools: [], mcps: [] });
      const bucket = byStage.get(row.stage)[
        row.kind === 'skill' ? 'skills' : row.kind === 'tool' ? 'tools' : 'mcps'
      ];
      bucket.push({
        name: row.name,
        source: row.source,
        sourceUrl: row.source_url,
        description: row.description,
        enabled: row.enabled,
        priority: row.priority,
        updatedAt: row.updated_at,
      });
    }
    const caps = require('../agent/stage-capabilities');
    res.json({
      stages: caps.all().map((stage) => ({
        stage: stage.stage,
        name: stage.name,
        goal: stage.goal,
        guide: stage.guide,
        skills: byStage.get(stage.stage)?.skills || [],
        tools: byStage.get(stage.stage)?.tools || [],
        mcps: byStage.get(stage.stage)?.mcps || [],
        execution: ['design', 'dev', 'test'].includes(stage.stage) ? 'EXEC' : 'BLOCKED',
      })),
    });
  } catch (e) {
    next(e);
  }
});

// 单阶段配置（配置中心详情视图）
router.get('/stage-capabilities/:stage', async (req, res, next) => {
  try {
    const db = require('../runtime').db();
    const ctx = require('../access').current();
    const rows = await require('../agent/stage-capabilities-config').forStage(
      db,
      ctx,
      req.params.stage,
    );
    res.json({ stage: req.params.stage, entries: rows });
  } catch (e) {
    next(e);
  }
});

// 批量保存阶段配置（owner 专属；幂等 upsert，页面保存入口）
router.put('/stage-capabilities/:stage', async (req, res, next) => {
  try {
    const db = require('../runtime').db();
    const ctx = require('../access').current();
    const svc = require('../agent/stage-capabilities-config');
    const stage = String(req.params.stage);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) {
      res.status(400).json({ error: { code: 'ENTRIES_REQUIRED' } });
      return;
    }
    const results = [];
    for (const entry of entries)
      results.push(await svc.upsert(db, ctx, { ...entry, stage }));
    res.json({ stage, results });
  } catch (e) {
    next(e);
  }
});

// 移除阶段能力（热插拔；owner 专属）
router.delete('/stage-capabilities/:stage/:kind/:name', async (req, res, next) => {
  try {
    const db = require('../runtime').db();
    const ctx = require('../access').current();
    const result = await require('../agent/stage-capabilities-config').remove(
      db,
      ctx,
      req.params.stage,
      req.params.kind,
      decodeURIComponent(req.params.name),
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
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
router.get('/requirements/:reqId/tool-control', async (req, res, next) => {  try {
    const access = require('../access'),
      ctx = access.current(),
      db = require('../runtime').db();
    if (!['007', '008'].includes(db.targetVersion))
      return res.status(409).json({ code: 'AGENT_SCHEMA_REQUIRED' });
    const result = await require('../domain/membership-policy').read(
      db,
      ctx,
      false,
      async (client) => {
        const requirement = (
          await client.query(
            `SELECT id FROM "${db.schema}".reqs WHERE tenant_id=$1 AND public_id=$2`,
            [ctx.tenantId, req.params.reqId],
          )
        ).rows[0];
        if (!requirement) access.fail('NOT_FOUND', 404);
        const reqId = requirement.id;
        const approvals = (
          await client.query(
            `SELECT a.id,a.job_id,a.state,a.scope_hash,a.expires_at,a.request FROM "${db.schema}".agent_approvals a WHERE a.tenant_id=$1 AND a.req_id=$2 ORDER BY a.created_at DESC LIMIT 100`,
            [ctx.tenantId, reqId],
          )
        ).rows.map((a) => ({
          id: a.id,
          jobId: a.job_id,
          state: a.state,
          scopeHash: a.scope_hash,
          expiresAt: a.expires_at,
          tool: a.request.tool ?? a.request.kind,
          path: a.request.arguments?.path ?? null,
          requiresNewPlan: true,
        }));
        const executions = (
          await client.query(
            `SELECT id,job_id,state,evidence,exit_code FROM "${db.schema}".tool_executions WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at DESC LIMIT 100`,
            [ctx.tenantId, reqId],
          )
        ).rows.map((t) => ({
          id: t.id,
          jobId: t.job_id,
          state: t.state,
          exitCode: t.exit_code,
          tool: t.evidence?.tool ?? null,
          path: t.evidence?.path ?? null,
          sha256: t.evidence?.sha256 ?? null,
          code: t.evidence?.code ?? null,
        }));
        return {
          reqId: req.params.reqId,
          approvals,
          executions,
          execution: require('../agent/execution-policy').capability(),
        };
      },
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});
// ---- 52 号：阶段基线冻结 / 撤权复核（owner）----
async function stageReq(db, ctx, reqId, ownerOnly = true) {
  const access = require('../access');
  const row = await require('../domain/membership-policy').read(
    db,
    ctx,
    ownerOnly,
    async (client) => {
      const r = (
        await client.query(
          `SELECT * FROM "${db.schema}".reqs WHERE tenant_id=$1 AND public_id=$2`,
          [ctx.tenantId, reqId],
        )
      ).rows[0];
      if (!r) access.fail('NOT_FOUND', 404);
      return r;
    },
  );
  return row;
}

router.get('/requirements/:reqId/stage-plan', async (req, res, next) => {
  try {
    const access = require('../access'),
      ctx = access.current(),
      db = require('../runtime').db();
    if (db.targetVersion !== '008')
      return res.status(409).json({ code: 'STAGE_PLAN_SCHEMA_REQUIRED' });
    const stage = String(req.query.stage || 'dev');
    const reqRow = await stageReq(db, ctx, req.params.reqId, false);
    const plan = await require('../agent/stage-plan').get(db, ctx, reqRow, stage);
    res.json(plan);
  } catch (e) {
    next(e);
  }
});

router.post('/requirements/:reqId/stage-plan/freeze', async (req, res, next) => {
  try {
    const access = require('../access'),
      ctx = access.current(true),
      db = require('../runtime').db();
    if (db.targetVersion !== '008')
      return res.status(409).json({ code: 'STAGE_PLAN_SCHEMA_REQUIRED' });
    const body = req.body || {};
    if (
      Object.keys(body).some(
        (k) => !['stage', 'workspace', 'control'].includes(k),
      ) ||
      typeof body.stage !== 'string' ||
      typeof body.workspace !== 'string' ||
      !body.control ||
      typeof body.control !== 'object'
    )
      access.fail('INVALID_INPUT', 400);
    const reqRow = await stageReq(db, ctx, req.params.reqId);
    const plan = await require('../agent/stage-plan').freeze(db, ctx, reqRow, {
      stage: body.stage,
      workspace: body.workspace,
      control: body.control,
    });
    res.json(plan);
  } catch (e) {
    next(e);
  }
});

router.post('/requirements/:reqId/stage-plan/review', async (req, res, next) => {
  try {
    const access = require('../access'),
      ctx = access.current(true),
      db = require('../runtime').db();
    if (db.targetVersion !== '008')
      return res.status(409).json({ code: 'STAGE_PLAN_SCHEMA_REQUIRED' });
    const stage = String((req.body || {}).stage || 'dev');
    const reqRow = await stageReq(db, ctx, req.params.reqId);
    const diff = await require('../agent/stage-plan').review(db, ctx, reqRow, stage);
    res.json(diff);
  } catch (e) {
    next(e);
  }
});

router.post('/requirements/:reqId/stage-plan/revoke', async (req, res, next) => {
  try {
    const access = require('../access'),
      ctx = access.current(true),
      db = require('../runtime').db();
    if (db.targetVersion !== '008')
      return res.status(409).json({ code: 'STAGE_PLAN_SCHEMA_REQUIRED' });
    const stage = String((req.body || {}).stage || 'dev');
    const reqRow = await stageReq(db, ctx, req.params.reqId);
    const result = await require('../agent/stage-plan').revoke(db, ctx, reqRow, stage);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
module.exports = router;
