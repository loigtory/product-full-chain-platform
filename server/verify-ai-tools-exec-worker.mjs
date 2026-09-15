'use strict';
// exec worker（runExecJob）端到端验证：真实模型调用 1 次。
// 链路：fixture schema → ai 消息 → enqueue EXEC job（受限读目录注入）→
// runExecJob（CLI host codex exec + 受限读 hook + 流式写回）→
// 断言 job SUCCEEDED、ai 消息 final 含探针 JSON（outsideReadDenied=true）、
// 受限读目录清理后无残留 deny。
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { aiDatabaseFixture } from './test-data/ai-tools-fixture.mjs';
import { withTransaction } from './src/persistence/transaction.js';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'exec worker runExecJob end-to-end: enqueue EXEC job → CLI host exec + restricted-read hook → ai message written back; assert SUCCEEDED + outsideReadDenied=true + cleanup',
  modelTurns: 1,
  checks: [],
};
const check = (name, fn) => {
  try {
    fn();
    report.checks.push({ name, pass: true });
  } catch (e) {
    report.checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
};

// EVIDENCE_ONLY 证据模式（与 exec-cli/real 一致）：引用已入库 PASS 证据断言，
// 不建 schema、不跑模型、不消耗预算。证据文件来自 docs/quality-gate/reports/ai-tools-integration-20260914/。
if (process.env.EVIDENCE_ONLY) {
  const evReport = {
    at: new Date().toISOString(),
    status: 'FAIL',
    scope: 'exec worker EVIDENCE_ONLY（引用已入库 PASS 证据，不跑模型）',
    modelTurns: 0,
    checks: [],
    evidenceOnly: process.env.EVIDENCE_ONLY,
  };
  try {
    const evPath = path.join(
      here,
      '..',
      'docs/quality-gate/reports/ai-tools-integration-20260914',
      process.env.EVIDENCE_ONLY,
    );
    const ev = JSON.parse(readFileSync(evPath, 'utf8'));
    const echeck = (name, fn) => {
      try {
        fn();
        evReport.checks.push({ name, pass: true });
      } catch (e) {
        evReport.checks.push({ name, pass: false, error: String(e.message || e) });
        throw e;
      }
    };
    echeck('evidence status PASS', () => assert.equal(ev.status, 'PASS'));
    echeck('evidence runResult SUCCEEDED', () =>
      assert.equal(ev.runResult && ev.runResult.status, 'SUCCEEDED'),
    );
    echeck('evidence probe outsideReadDenied=true', () =>
      assert.equal(ev.probe && ev.probe.outsideReadDenied, true),
    );
    evReport.status = 'PASS';
  } catch (e) {
    evReport.error = String(e.message || e);
  }
  console.log(JSON.stringify(evReport, null, 2));
  process.exit(evReport.status === 'PASS' ? 0 : 1);
}

// 预算账本：不自行 lock（worker 内部 reserveTurn/settleTurn 已含 lock+登记+结算），
// 仅在跑前后做 turns 快照断言真实消耗。
const ledgerPath = path.resolve('.local/ai-tools-integration-20260914/preflight/configs/model-budget.json');
const readTurns = () => JSON.parse(readFileSync(ledgerPath, 'utf8')).turns;
const turnsBefore = readTurns();

const codexJs = 'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
process.env.PFC_CODEX_BINARY = process.env.PFC_CODEX_BINARY || codexJs;
process.env.PFC_CODEX_BINARY_SHA256 = process.env.PFC_CODEX_BINARY_SHA256 || '';

let f = null;
let root = null;
try {
  f = await aiDatabaseFixture('exec');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(f.db);
  await assertReady(f.db);
  const seeded = await f.seed();
  const { ctx, req } = seeded;
  const reqPublicId = req.public_id;

  // 临时 exec 工作区（必须位于项目 git 仓库内）+ 受限读目录
  root = mkdtempSync(path.join(path.resolve('.local/ai-tools-integration-20260914/preflight'), 'CODEx_TEST_execworker_'));
  const workspace = path.join(root, 'workspace');
  const configs = path.join(root, 'configs');
  mkdirSync(workspace);
  mkdirSync(configs);
  const canary = path.join(configs, 'canary.txt');
  writeFileSync(canary, 'CODEx_TEST_OUTSIDE_CANARY', 'utf8');
  const probe = path.join(workspace, 'probe.ps1');
  writeFileSync(
    probe,
    [
      "$ErrorActionPreference = 'Continue'",
      '$result = @{ insideWrite = $false; outsideReadDenied = $false; outsideWriteDenied = $false }',
      "try { Set-Content -Path (Join-Path $PWD 'inside.txt') -Value 'CODEx_TEST_INSIDE' -Encoding Ascii; $result.insideWrite = $true } catch {}",
      "try { Get-Content -Path $args[0] -Raw -ErrorAction Stop | Out-Null } catch { $result.outsideReadDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      "try { Set-Content -Path ($args[0] + '.write') -Value 'x' -Encoding Ascii -ErrorAction Stop } catch { $result.outsideWriteDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      '$result | ConvertTo-Json -Compress',
    ].join('\r\n'),
    'utf8',
  );
  const prompt =
    'CODEx_TEST_AI_TOOLS_20260914。运行探针脚本并报告结果：执行 PowerShell 命令 `powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 "' +
    canary +
    '"`。探针输出一行 JSON（字段 insideWrite、outsideReadDenied、outsideWriteDenied）。把该 JSON 原样作为最终回复，不要修改内容、不要额外解释。';

  // 预算登记由 worker 内部 reserveTurn 完成（lock+登记+结算）；此处仅确认消耗发生
  const turnsBeforeJob = readTurns();

  // 建 ai 消息 + enqueue EXEC job（同一事务）
  const enqueued = await withTransaction(f.db, async (client) => {
    const messages = require('./src/persistence/messages');
    const jobs = require('./src/persistence/agent-jobs');
    const ai = await messages.create(client, f.db, ctx, req, {
      turnId: randomUUID(),
      role: 'ai',
      stage: 'idea',
      content: '',
      status: 'generating',
      metadata: { real: true },
    });
    const job = await jobs.enqueue(client, f.db, ctx, req, {
      commandId: 'EXEC-' + ai.id,
      kind: 'EXECUTE',
      inputHash: createHash('sha256')
        .update(JSON.stringify({ content: prompt, workspace, restrictedReadDirs: [configs] }))
        .digest('hex'),
      input: {
        userMessageId: 'MSG-' + randomUUID(),
        aiMessageId: ai.id,
        content: prompt,
        workspace,
        restrictedReadDirs: [configs],
      },
    });
    return { ai, job };
  });

  const { runExecJob } = await import('./src/agent/worker.js');
  const result = await runExecJob({ db: f.db, ctx, reqPublicId, jobId: enqueued.job.id });
  report.runResult = { status: result.status, code: result.code || null };
  check('runExecJob SUCCEEDED', () => assert.equal(result.status, 'SUCCEEDED'));

  // job 终态 + ai 消息写回
  const jobRow = (
    await f.db.pool.query(
      `SELECT state,result FROM "${f.db.schema}".agent_jobs WHERE id=$1`,
      [enqueued.job.id],
    )
  ).rows[0];
  check('agent_jobs final state SUCCEEDED', () =>
    assert.equal(jobRow.state, 'SUCCEEDED'),
  );
  const aiRow = (
    await f.db.pool.query(
      `SELECT status,content,metadata FROM "${f.db.schema}".messages WHERE id=$1`,
      [enqueued.ai.id],
    )
  ).rows[0];
  check('ai message final ok', () => assert.equal(aiRow.status, 'ok'));
  const probeMatch = aiRow.content.match(/\{[^{}]*"insideWrite"[\s\S]*?\}/);
  check('probe JSON written into ai message', () => assert.ok(probeMatch));
  const probeResult = probeMatch ? JSON.parse(probeMatch[0]) : {};
  report.probe = probeResult;
  check('outsideReadDenied=true (restricted-read enforced in exec worker)', () =>
    assert.equal(probeResult.outsideReadDenied, true),
  );
  check('insideWrite=true', () => assert.equal(probeResult.insideWrite, true));

  // 受限读清理后无残留 deny
  const aclOut = execFileSync('icacls', [configs], { encoding: 'utf8', windowsHide: true });
  check('restricted-read ACL removed after job', () =>
    assert.ok(!/CodexSandboxUsers:\(OI\)\(CI\)\(DENY\)\(R\)/.test(aclOut)),
  );

  check('model budget consumed exactly one turn', () =>
    assert.equal(readTurns(), turnsBeforeJob + 1),
  );
  report.status = 'PASS';
} catch (e) {
  report.error = String(e.message || e);
} finally {
  if (root) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
  if (f) {
    try {
      const c = await f.cleanup();
      report.cleanup = c;
    } catch (e) {
      report.cleanupError = String(e.message || e);
    }
  }
}

const outPath = path.join(
  here,
  '..',
  'docs/quality-gate/reports/ai-tools-integration-20260914',
  `exec-worker-${Date.now()}.json`,
);
import { mkdirSync as mk, writeFileSync as wr } from 'node:fs';
mkdirSync(path.dirname(outPath), { recursive: true });
wr(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, 'PASS', 'exec worker end-to-end failed');
