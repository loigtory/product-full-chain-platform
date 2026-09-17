import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { aiDatabaseFixture } from './test-data/ai-tools-fixture.mjs';

// 50 号真实模型链验收：codex host 模式真实调用 pfc_run_checks（审批流命令执行）
// 场景：合成项目 sum.js 有 bug → 模型跑测试失败 → 读文件 → pfc_write_file 修复
//       → 再跑测试通过 → 断言工具审计/文件实际修复/模型汇报。
// 预算：hostBudget()（.local/ai-tools-host-exec-20260917/budget.json），1 次真实模型 turn。
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const nodeBin = path.join(repoRoot, '.tools/node-v24.20.0-win-x64/node.exe');
const hash = (v) => createHash('sha256').update(v).digest('hex');

const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '50-approval-flow real model chain (pfc_run_checks)',
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

const source = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
    ),
    'utf8',
  ),
).source;
const options = {
  binary: path.join(
    process.env.APPDATA,
    'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  ),
  expectedSha256:
    'be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde',
  expectedConnectionFingerprint:
    'b585d723d61d18a815b77a2d81627cd71038d1f8cf7f4446f56e48eba4937292',
  mode: 'host',
  approvedInstructionSources: [source],
  enabledSkills: [],
};

let fixture;
let session, reservation, heartbeat, started;
let status = 'FAILED';
let workRoot, workspace;
try {
  // ---- preflight：连接与工具配置验证（不耗模型） ----
  {
    const { openProtocol } = await import('./src/agent/protocol.mjs');
    const runId = 'CODEx_TEST_AI_HOST_20260917_' + randomUUID();
    workRoot = path.join(repoRoot, '.local/ai-tools-host-exec-20260917', runId);
    workspace = path.join(workRoot, 'workspace', 'cmd-real');
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
    const conn = await openProtocol({ ...options, cwd: workspace });
    report.preflight = {
      instanceIsolation: conn.summary.instanceIsolation,
      model: conn.summary.model,
      textIsolation: conn.summary.textIsolation,
    };
    await check('preflight: 连接与工具配置验证通过', () => {
      assert.equal(conn.summary.instanceIsolation, 'CONFIG_VERIFIED');
      assert.ok(Object.values(conn.summary.textIsolation).every((v) => v === true));
    });
    const exit = await conn.close();
    assert.equal(exit.childExited, true);
  }

  // ---- 真实模型链：runExecJob 等价链路（TextConversation host + dispatch） ----
  fixture = await aiDatabaseFixture('control');
  const { migrate } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  const { withTransaction: tx } = require('./src/persistence/transaction');
  const jobs = require('./src/persistence/agent-jobs'),
    ec = require('./src/agent/exec-control');
  const budget = require('./src/agent/budget').hostBudget();
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
        allowedCommands: [[nodeBin, '--test', '--test-reporter=tap']],
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
      inputHash: hash('synthetic-real'),
      input: { stage: 'dev', workspace, contextHash: snapshot.hash, control: plan },
    });
    await jobs.claimById(c, fixture.db, j.id, ownerId);
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
  heartbeat = setInterval(
    () => tx(fixture.db, (c) => jobs.heartbeat(c, fixture.db, job.id, ownerId)).catch(() => control.stop('AGENT_LEASE_LOST')),
    10000,
  );
  const calls = [];
  console.error('[diag] opening TextConversation at', new Date().toISOString());
  session = await require('./src/agent/conversation-provider').TextConversation.open({
    ...options,
    cwd: workspace,
    onToolCall: async (bound) => {
      calls.push({ tool: bound.tool, callId: bound.callId, itemId: bound.itemId });
      console.error('[diag] tool call:', bound.tool, 'at', new Date().toISOString());
      return dispatch(bound);
    },
  });
  control.attach(session);
  console.error('[diag] runText starting at', new Date().toISOString());
  const completion = session.runText({
    text: 'This synthetic development task and its frozen plan are already approved by the Owner. The workspace is a small Node ESM project (package.json, sum.js, sum.test.js). Use pfc_run_checks to run the tests and observe the TAP output. The test currently fails because sum.js has a bug. Use pfc_read_file to read sum.js and sum.test.js, then use pfc_write_file on sum.js with the exact returned sha256 as expectedHash and corrected content so that sum(2, 3) === 5. Then run pfc_run_checks again and confirm the tests pass. Report only what actually happened; quote the final TAP result.',
    reserveTurn: async () => {
      reservation = await budget.reserveTurn();
      started = Date.now();
      report.modelCalls = (report.modelCalls ?? 0) + 1;
      await tx(fixture.db, (c) => jobs.dispatch(c, fixture.db, job.id, ownerId));
    },
  });
  console.error('[diag] awaiting completion at', new Date().toISOString());
  const completionResult = await completion;
  console.error('[diag] completion resolved at', new Date().toISOString());
  const exit = await session.close();
  console.error('[diag] session closed, childExited=' + exit.childExited, new Date().toISOString());
  assert.equal(exit.childExited, true);
  console.error('[diag] job finish at', new Date().toISOString());
  await tx(fixture.db, (c) => jobs.finish(c, fixture.db, job.id, ownerId, 'SUCCEEDED', { synthetic: true }, null));
  report.modelCalls ??= 0;

  // ---- 断言 ----
  await check('真实模型调用了 pfc_run_checks（至少 2 次）', () => {
    const cmds = calls.filter((c) => c.tool === 'pfc_run_checks');
    assert.ok(cmds.length >= 2, `expected >=2 pfc_run_checks, got ${cmds.length}`);
  });
  await check('tool_executions 命令审计：全部 SUCCEEDED', async () => {
    const rows = (
      await fixture.db.pool.query(
        `SELECT state, evidence FROM "${fixture.db.schema}".tool_executions WHERE job_id=$1 ORDER BY created_at`,
        [job.id],
      )
    ).rows;
    const cmds = rows.filter((r) => r.evidence?.tool === 'pfc_run_checks');
    console.error('[diag] tool_executions rows:', JSON.stringify(rows.map((r) => ({ state: r.state, tool: r.evidence?.tool, exitCode: r.evidence?.exitCode, cmd: (r.evidence?.command || []).slice(0, 4) }))));
    assert.ok(cmds.length >= 2, `expected >=2 command rows, got ${cmds.length}`);
    assert.ok(cmds.every((r) => r.state === 'SUCCEEDED'));
    assert.ok(cmds[0].evidence.exitCode === 1, 'first run must fail');
    assert.ok(cmds.at(-1).evidence.exitCode === 0, 'last run must pass');
  });
  await check('sum.js 被实际修复且测试通过', async () => {
    const src = fs.readFileSync(path.join(workspace, 'sum.js'), 'utf8');
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(path.join(workspace, 'sum.js')).href);
    const sum = mod.sum ?? (mod.default && (mod.default.sum ?? mod.default));
    assert.equal(typeof sum, 'function', 'sum should be importable');
    assert.equal(sum(2, 3), 5);
    assert.match(src, /return a \+ b/);
  });
  await check('模型汇报引用最终 TAP 通过', () => {
    const text = String(completionResult?.text || '');
    console.error('[diag] assistant final text:', JSON.stringify(text.slice(0, 1200)));
    assert.ok(text && /# pass/.test(text), 'final assistant message should cite TAP pass line');
  });

  status = 'SUCCEEDED';
  console.error('[diag] ALL CHECKS DONE at', new Date().toISOString());
} catch (e) {
  console.error('[diag] CATCH:', e.code || e.message, new Date().toISOString());
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: String(e.message || e).slice(0, 600) };
  process.exitCode = 1;
} finally {
  console.error('[diag] finally entered at', new Date().toISOString());
  try {
    if (session) {
      const exit = await session.close();
      if (exit?.childExited !== true && status === 'SUCCEEDED') status = 'UNKNOWN';
    }
    clearInterval(heartbeat);
  } catch {}
  if (reservation)
    try {
      await require('./src/agent/budget').hostBudget().settleTurn(
        (Date.now() - started) / 1000,
        status,
        {},
        reservation.attemptId,
      );
    } catch {}
  try { await fixture?.cleanup(); } catch {}
  try {
    fs.rmSync(workRoot, { recursive: true, force: true });
  } catch {}
  report.status = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
  report.checks = checks;
  console.log(JSON.stringify(report, null, 2));
}
