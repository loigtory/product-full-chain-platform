import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { aiDatabaseFixture } from './test-data/ai-tools-fixture.mjs';

// 命令审批流集成验证（驱动 createHostDispatcher 全链，不依赖模型）：
// 1) pfc_run_checks（allowedCommands 含 node-test 向量）→ 白名单执行 → SUCCEEDED + 审计落库
// 2) pfc_run_checks（allowedCommands 不含）→ COMMAND_NOT_IN_PLAN → 拒绝 + DENIED 记录
// 3) pfc_git_status → SUCCEEDED + porcelain 输出
// 4) 未知工具 → TOOL_NOT_ALLOWED
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const nodeBin = path.join(repoRoot, '.tools/node-v24.20.0-win-x64/node.exe');
const hash = (v) => createHash('sha256').update(v).digest('hex');

const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '49-approval-flow command dispatch integration gates',
  modelTurns: 0,
  checks: [],
};
const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, pass: true });
  } catch (e) {
    checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
};

let fixture;
try {
  fixture = await aiDatabaseFixture('control');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { withTransaction: tx } = require('./src/persistence/transaction');
  const jobs = require('./src/persistence/agent-jobs'),
    ec = require('./src/agent/exec-control');

  const runId = 'CODEx_TEST_AI_HOST_20260917_' + randomUUID();
  const workRoot = path.join(repoRoot, '.local/ai-tools-host-exec-20260917', runId);
  const workspace = path.join(workRoot, 'workspace', 'cmd');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'synthetic', type: 'module', private: true }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(workspace, 'sum.js'),
    'export function sum(a, b) {\n  return a * b; // BUG\n}\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(workspace, 'sum.test.js'),
    "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum.js';\ntest('sum(2,3) === 5', () => { assert.equal(sum(2, 3), 5); });\n",
    'utf8',
  );
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'pfc-test@local'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'pfc-test'], { cwd: workspace, stdio: 'ignore' });

  const nodeTest = [nodeBin, '--test', '--test-reporter=tap'];
  const gitStatus = ['git', 'status', '--porcelain=v1'];
  const allowedCommands = [nodeTest, gitStatus];

  async function makeDispatch(allowedCommandsArg) {
    const { ctx, req } = await fixture.seed();
    await tx(fixture.db, (c) =>
      c.query(`UPDATE "${fixture.db.schema}".reqs SET stage='dev' WHERE id=$1`, [req.id]),
    );
    req.stage = 'dev';
    const snapshot = await tx(fixture.db, (c) =>
      require('./src/agent/context-service').stageSnapshot(
        c,
        fixture.db,
        ctx,
        req,
        'dev',
      ),
    );
    const plan = ec.freezeForActor(
      {
        workspace,
        control: {
          confirmed: true,
          mode: 'strict',
          allowedFiles: ['**'],
          allowedCommands: allowedCommandsArg,
          validUntil: new Date(Date.now() + 120000).toISOString(),
          baselineHash: ec.baselineHash(ec.scanWorkspace(workspace)),
        },
      },
      ctx,
      req,
      snapshot.hash,
    );
    const ownerId = randomUUID();
    const job = await tx(fixture.db, async (c) => {
      const j = await jobs.enqueue(c, fixture.db, ctx, req, {
        kind: 'EXECUTE',
        commandId: randomUUID(),
        inputHash: hash('synthetic'),
        input: {
          stage: 'dev',
          workspace,
          contextHash: snapshot.hash,
          control: plan,
        },
      });
      await jobs.claimById(c, fixture.db, j.id, ownerId);
      await jobs.dispatch(c, fixture.db, j.id, ownerId);
      return j;
    });
    fixture.createdIds.push(job.id);
    const scope = require('./src/agent/scope-policy').createScope(workspace, plan);
    const control = require('./src/agent/job-control').createControl();
    const dispatch = require('./src/agent/approval-service').createHostDispatcher({
      db: fixture.db,
      ctx,
      reqPublicId: req.public_id,
      jobId: job.id,
      ownerId,
      scope,
      control,
    });
    return { ctx, job, ownerId, dispatch };
  }

  const bound = (tool, requestId) => ({
    requestId,
    threadId: 'CODEx_TEST_thread',
    turnId: 'CODEx_TEST_turn',
    callId: 'call-' + requestId,
    itemId: 'call-' + requestId,
    tool,
    arguments: {},
  });

  // ---- 1) 白名单命令执行 → SUCCEEDED + 审计落库 ----
  const A = await makeDispatch(allowedCommands);
  await check('pfc_run_checks: 白名单内执行且返回 TAP 输出', async () => {
    const r = await A.dispatch(bound('pfc_run_checks', 'r1'));
    assert.equal(r.success, true);
    const data = JSON.parse(r.contentItems[0].text);
    assert.equal(data.exitCode, 1);
    assert.match(data.stdout, /not ok/);
  });
  await check('pfc_run_checks: tool_executions 落 SUCCEEDED 审计', async () => {
    const rows = (
      await fixture.db.pool.query(
        `SELECT state, evidence FROM "${fixture.db.schema}".tool_executions WHERE job_id=$1 ORDER BY id`,
        [A.job.id],
      )
    ).rows;
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].state, 'SUCCEEDED');
    const ev = rows[0].evidence;
    assert.equal(ev.tool, 'pfc_run_checks');
    assert.equal(ev.exitCode, 1);
    assert.ok(ev.stdoutBytes > 0);
    assert.ok(ev.contextHash);
  });

  // ---- 3) git status 执行 ----
  const C = await makeDispatch(allowedCommands);
  await check('pfc_git_status: 白名单内执行且输出 porcelain', async () => {
    const r = await C.dispatch(bound('pfc_git_status', 'r1'));
    assert.equal(r.success, true);
    const data = JSON.parse(r.contentItems[0].text);
    assert.equal(data.exitCode, 0);
    assert.match(data.stdout, /^\?\? /m);
  });

  // ---- 2) 计划外命令拒绝 ----
  const B = await makeDispatch([]);
  await check('pfc_run_checks: 计划外命令被拒绝 COMMAND_NOT_IN_PLAN', async () => {
    const r = await B.dispatch(bound('pfc_run_checks', 'r1'));
    assert.equal(r.success, false);
    const data = JSON.parse(r.contentItems[0].text);
    assert.equal(data.code, 'COMMAND_NOT_IN_PLAN');
  });
  await check('pfc_run_checks: 拒绝记录为 DENIED 审批', async () => {
    const rows = (
      await fixture.db.pool.query(
        `SELECT state FROM "${fixture.db.schema}".agent_approvals WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [B.job.id],
      )
    ).rows;
    assert.equal(rows[0]?.state, 'DENIED');
    // rejection code 落在 agent_events 审计
    const ev = (
      await fixture.db.pool.query(
        `SELECT payload FROM "${fixture.db.schema}".agent_events WHERE job_id=$1 AND type='approval' ORDER BY created_at DESC LIMIT 1`,
        [B.job.id],
      )
    ).rows;
    assert.ok(ev.length >= 1);
    assert.equal(ev[0].payload?.code, 'COMMAND_NOT_IN_PLAN');
  });

  // ---- 4) 未知工具拒绝 ----
  await check('未知工具 pfc_unknown → TOOL_NOT_ALLOWED', async () => {
    const r = await B.dispatch(bound('pfc_unknown', 'r2'));
    assert.equal(r.success, false);
    const data = JSON.parse(r.contentItems[0].text);
    assert.equal(data.code, 'TOOL_NOT_ALLOWED');
  });

  report.status = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: String(e.message || e).slice(0, 500) };
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.cleanup();
  try {
    fs.rmSync(path.join(repoRoot, '.local/ai-tools-host-exec-20260917'), {
      recursive: true,
      force: true,
    });
  } catch {}
  report.checks = checks;
  console.log(JSON.stringify(report, null, 2));
}
