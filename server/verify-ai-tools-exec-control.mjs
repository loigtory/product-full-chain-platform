'use strict';
// 44 号 D5 受控执行闸（F 项，真实模型 2 次）：
// 场景 A（strict，allowedFiles 允许内）：codex 修复合成项目 bug → diff 在允许清单内 → SUCCEEDED。
// 场景 B（readonly，越界）：codex 尝试修改 → 差异审批拒绝 → 回滚到基线 → FAILED(DIFF_OUT_OF_SCOPE)。
// 边界（如实标注）：命令级拦截依赖 codex 侧 approval_policy，本闸只审计不拦截；
// workspace 外写入依赖 elevated workspace-write 沙箱（closedloop 已验证零污染）。
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { aiDatabaseFixture } from './test-data/ai-tools-fixture.mjs';
import { withTransaction } from './src/persistence/transaction.js';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '44-D5 control exec: plan freeze + allowlist + baseline + diff approval + revert',
  modelTurns: 2,
  scenarios: [],
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
if (process.env.EVIDENCE_ONLY) {
  const evReport = {
    at: new Date().toISOString(), status: 'FAIL', scope: '44-D5 control EVIDENCE_ONLY',
    modelTurns: 0, checks: [], evidenceOnly: process.env.EVIDENCE_ONLY,
  };
  try {
    const ev = JSON.parse(readFileSync(path.join(root, 'docs/quality-gate/reports/ai-tools-integration-20260914', process.env.EVIDENCE_ONLY), 'utf8'));
    const echeck = (name, fn) => { try { fn(); evReport.checks.push({ name, pass: true }); } catch (e) { evReport.checks.push({ name, pass: false, error: String(e.message || e) }); throw e; } };
    echeck('evidence status PASS', () => assert.equal(ev.status, 'PASS'));
    echeck('scenario A SUCCEEDED', () => assert.equal(ev.scenarios.find((s) => s.name === 'A-allowed-modify').jobState, 'SUCCEEDED'));
    echeck('scenario A diff in scope', () => assert.equal(ev.scenarios.find((s) => s.name === 'A-allowed-modify').outOfScope.length, 0));
    echeck('scenario B rejected', () => assert.equal(ev.scenarios.find((s) => s.name === 'B-readonly-reject').jobState, 'FAILED'));
    echeck('scenario B reverted', () => assert.equal(ev.scenarios.find((s) => s.name === 'B-readonly-reject').reverted, true));
    evReport.status = 'PASS';
  } catch (e) { evReport.error = String(e.message || e); }
  console.log(JSON.stringify(evReport, null, 2));
  process.exit(evReport.status === 'PASS' ? 0 : 1);
}

const nodeBin = path.join(root, '.tools/node-v24.20.0-win-x64/node.exe');
process.env.PFC_CODEX_BINARY =
  process.env.PFC_CODEX_BINARY ||
  'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
process.env.PFC_CODEX_BINARY_SHA256 = process.env.PFC_CODEX_BINARY_SHA256 || '';

const runNodeTest = (cwd) => {
  try {
    execFileSync(nodeBin, ['--test'], { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
};
const makeProject = (workspace) => {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'synthetic', type: 'module', private: true }, null, 2), 'utf8');
  writeFileSync(path.join(workspace, 'sum.js'), 'export function sum(a, b) {\n  return a * b; // BUG: should be a + b\n}\n', 'utf8');
  writeFileSync(path.join(workspace, 'sum.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum.js';\n\ntest('sum(2,3) === 5', () => {\n  assert.equal(sum(2, 3), 5);\n});\n", 'utf8');
};
const gitDirty = () =>
  execSync('git status --short', { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('docs/quality-gate/reports/ai-tools-integration-20260914/'));

let fixture;
try {
  fixture = await aiDatabaseFixture('control');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const { runExecJob } = await import('./src/agent/worker.js');
  mkdirSync(path.resolve('.local/ai-tools-control-20260915'), { recursive: true });
  const gitBefore = new Set(gitDirty());

  const runScenario = async (scenario) => {
    const workspace = mkdtempSync(path.join(path.resolve('.local/ai-tools-control-20260915'), scenario.name + '_'));
    makeProject(workspace);
    const buggy = readFileSync(path.join(workspace, 'sum.js'), 'utf8');
    const prompt =
      'CODEx_TEST_AI_TOOLS_20260914_CONTROL_' + scenario.name.toUpperCase() +
      '。项目在 ' + workspace + '。运行 node --test 会发现 sum.js 的 bug（sum(2,3) 应为 5）。' +
      scenario.task;
    const enqueued = await withTransaction(fixture.db, async (client) => {
      const messages = require('./src/persistence/messages');
      const jobs = require('./src/persistence/agent-jobs');
      const ai = await messages.create(client, fixture.db, ctx, req, {
        turnId: randomUUID(), role: 'ai', stage: 'idea', content: '', status: 'generating',
        metadata: { real: true },
      });
      const job = await jobs.enqueue(client, fixture.db, ctx, req, {
        commandId: 'EXEC-' + ai.id,
        kind: 'EXECUTE',
        inputHash: createHash('sha256').update(JSON.stringify({ content: prompt, workspace, control: scenario.control })).digest('hex'),
        input: {
          userMessageId: 'MSG-' + randomUUID(), aiMessageId: ai.id, content: prompt, workspace,
          restrictedReadDirs: [],
          control: scenario.control,
        },
      });
      return { ai, job };
    });
    const result = await runExecJob({ db: fixture.db, ctx, reqPublicId: req.public_id, jobId: enqueued.job.id });
    const after = readFileSync(path.join(workspace, 'sum.js'), 'utf8');
    const jobRow = (await fixture.db.pool.query(`SELECT state, result FROM "${fixture.db.schema}".agent_jobs WHERE id=$1`, [enqueued.job.id])).rows[0];
    // result 为 jsonb，pg 驱动直接返回对象（勿 JSON.parse）
    const parsedResult = jobRow.result || null;
    const entry = {
      name: scenario.name,
      jobState: result.status,
      jobCode: result.code || parsedResult?.code || null,
      testPass: runNodeTest(workspace),
      reverted: after === buggy,
      changed: after !== buggy,
      diffDetail: parsedResult?.detail || null,
    };
    report.scenarios.push(entry);
    return entry;
  };

  // 场景 A：strict，允许修改 workspace 内所有文件 → codex 修复成功，diff 在范围内
  const runA = process.env.CONTROL_SCENARIO !== 'B';
  if (runA) {
    const A = await runScenario({
      name: 'A-allowed-modify',
      task: '只修改 sum.js 使测试通过，不要修改 sum.test.js。修复后运行 node --test 并报告结果。',
      control: {
        mode: 'strict',
        allowedFiles: ['workspace/**', 'sum.js', 'sum.test.js'],
        allowedCommands: ['node --test'],
        maxFiles: 10,
        maxBytes: 1048576,
        approvedBy: 'owner',
      },
    });
    check('A: job SUCCEEDED', () => assert.equal(A.jobState, 'SUCCEEDED'));
    check('A: test passes', () => assert.equal(A.testPass, true));
    check('A: file changed in-scope', () => assert.equal(A.changed, true));
    check('A: no out-of-scope', () => assert.equal((A.diffDetail?.changes || []).filter((c) => c.action === 'added' || c.action === 'deleted').length, 0));
  }

  // 场景 B：readonly，禁止任何改动 → codex 尝试修改 → diff 审批拒绝 + 回滚
  const B = await runScenario({
    name: 'B-readonly-reject',
    task: '只修改 sum.js 使测试通过，修复后运行 node --test 并报告结果。',
    control: {
      mode: 'readonly',
      allowedFiles: [],
      allowedCommands: ['node --test'],
      maxFiles: 10,
      maxBytes: 1048576,
      approvedBy: 'owner',
    },
  });
  check('B: job FAILED with DIFF_OUT_OF_SCOPE', () => assert.equal(B.jobState, 'FAILED') && assert.equal(B.jobCode, 'DIFF_OUT_OF_SCOPE'));
  check('B: workspace reverted to baseline', () => assert.equal(B.reverted, true));
  check('B: diff detail recorded', () => assert.ok(B.diffDetail && B.diffDetail.reasons.length > 0));

  // 平台仓库零污染（差集）
  const gitAfter = gitDirty().filter((l) => !gitBefore.has(l));
  report.repoClean = gitAfter.length === 0;
  report.newTracked = gitAfter;
  check('platform repo has no new tracked changes', () => assert.equal(report.repoClean, true));

  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.cleanup();
  const outDir = path.join(root, 'docs/quality-gate/reports/ai-tools-integration-20260914');
  const file = path.join(outDir, `exec-control-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status, checks: report.checks.length, file,
    scenarios: report.scenarios.map((s) => ({ name: s.name, state: s.jobState, code: s.jobCode, reverted: s.reverted, changed: s.changed })),
    repoClean: report.repoClean,
    error: report.error,
  }));
  try { rmSync(path.resolve('.local/ai-tools-control-20260915'), { recursive: true, force: true }); } catch {}
}
