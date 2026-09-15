'use strict';
// exec-worker 受限读集成骨架（端到端，真实模型调用 1 次）：
//   applyRestrictedReadAll(外目录) → codex exec (elevated + workspace-write) 探针
//   → 断言 outsideReadDenied=true → finally removeRestrictedReadAll。
// 本脚本即未来 exec worker 的受限读接入范式（job 领取/分发之外的安全层）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRestrictedReadAll,
  removeRestrictedReadAll,
} from './src/agent/restricted-read.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.join(
  here,
  '..',
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'exec-worker restricted-read integration skeleton: applyRestrictedReadAll around codex exec (elevated) probe, assert outsideReadDenied=true, cleanup in finally',
  modelTurns: 1,
  checks: [],
};

function check(name, fn) {
  try {
    fn();
    report.checks.push({ name, pass: true });
  } catch (e) {
    report.checks.push({ name, pass: false, error: String(e.message || e) });
    throw e;
  }
}

// 预算账本：登记/结算（与 verify-ai-tools-exec-cli.mjs 同款机制）
const ledgerPath = path.resolve('.local/ai-tools-integration-20260914/preflight/configs/model-budget.json');
import { openSync, closeSync, unlinkSync } from 'node:fs';
let lock = null;
let budget;
let lockPath = ledgerPath + '.lock';
try {
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  lock = openSync(lockPath, 'wx');
  budget = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(budget.package, '44-ai-tools-integration-20260914');
  assert.ok(Number.isSafeInteger(budget.turns) && budget.turns >= 0 && budget.turns < 40);
  assert.ok(
    Number.isFinite(budget.reservedSeconds) &&
      budget.reservedSeconds >= 0 &&
      budget.reservedSeconds + 300 <= 7200,
  );
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
  throw new Error('MODEL_BUDGET_LOCKED: another real-call gate is running');
}

let root = null;
let child = null;
try {
  // workspace 必须位于项目 git 仓库内（codex exec 要求 trusted dir），与 C3 探针一致
  root = mkdtempSync(path.join(path.resolve('.local/ai-tools-integration-20260914/preflight'), 'CODEx_TEST_execrr_'));
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
      '$result = @{ insideWrite = $false; outsideReadDenied = $false; outsideWriteDenied = $false; loopbackReachable = $null; externalNetworkDenied = $null }',
      "try { Set-Content -Path (Join-Path $PWD 'inside.txt') -Value 'CODEx_TEST_INSIDE' -Encoding Ascii; $result.insideWrite = $true } catch {}",
      "try { Get-Content -Path $args[0] -Raw -ErrorAction Stop | Out-Null } catch { $result.outsideReadDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      "try { Set-Content -Path ($args[0] + '.write') -Value 'x' -Encoding Ascii -ErrorAction Stop } catch { $result.outsideWriteDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      '$result | ConvertTo-Json -Compress',
    ].join('\r\n'),
    'utf8',
  );

  // 受限读 hook：会话前对工作区外目录 apply，finally 清理
  const applyResult = applyRestrictedReadAll([configs]);
  check('applyRestrictedReadAll applied', () => {
    assert.equal(applyResult.applied.length, 1);
  });

  const prompt =
    'CODEx_TEST_AI_TOOLS_20260914。运行探针脚本并报告结果：执行 PowerShell 命令 `powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 "' +
    canary +
    '"`。探针输出一行 JSON（字段 insideWrite、outsideReadDenied、outsideWriteDenied、loopbackReachable、externalNetworkDenied）。把该 JSON 原样作为最终回复，不要修改内容、不要额外解释。';

  // 预算登记
  budget.turns++;
  budget.reservedSeconds += 300;
  const reservation = {
    at: new Date().toISOString(),
    inputHash: createHash('sha256').update(prompt).digest('hex'),
    status: 'DISPATCHING',
    reservedSeconds: 300,
  };
  budget.attempts.push(reservation);
  writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');

  // codex 可执行：优先 PFC_CODEX_BINARY（.js 时用 node 跑），默认 npm 全局 codex.js
  const codexJs = 'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js';
  const binary = process.env.PFC_CODEX_BINARY || codexJs;
  const spawnBin = binary.endsWith('.js') ? process.execPath : binary;
  const spawnArgs = binary.endsWith('.js') ? [binary] : [];
  const startedAt = Date.now();
  const out = await new Promise((resolve, reject) => {
    child = spawn(
      spawnBin,
      spawnArgs.concat([
        'exec',
        '-s', 'workspace-write',
        '-c', 'windows.sandbox="elevated"',
        '-c', 'sandbox_workspace_write.network_access=false',
        '-c', 'approval_policy=never',
        '-C', workspace,
        '--disable', 'apps',
        '--disable', 'plugins',
        '--disable', 'hooks',
        '--disable', 'browser_use',
        '--disable', 'computer_use',
        '--disable', 'multi_agent',
      ]),
      { cwd: workspace, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr, code })
        : reject(new Error(`codex exec exited ${code}: ${stderr.slice(-500)}`)),
    );
    child.stdin.end(prompt);
  });
  const actualSeconds = Math.ceil((Date.now() - startedAt) / 1000);

  report.exec = {
    code: out.code,
    stdoutBytes: Buffer.byteLength(out.stdout),
    stderrBytes: Buffer.byteLength(out.stderr),
    stdoutTail: out.stdout.slice(-1200),
    actualSeconds,
  };
  const jsonMatch = out.stdout.match(/\{[^{}]*"insideWrite"[\s\S]*?\}/);
  check('probe JSON in stdout', () => assert.ok(jsonMatch, 'probe JSON not found'));
  const probeResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  report.probe = probeResult;
  check('outsideReadDenied=true (restricted read enforced)', () =>
    assert.equal(probeResult.outsideReadDenied, true),
  );
  check('insideWrite=true', () => assert.equal(probeResult.insideWrite, true));
  check('outsideWriteDenied=true', () =>
    assert.equal(probeResult.outsideWriteDenied, true),
  );

  // 结算
  budget.attempts[budget.attempts.length - 1].status = 'SUCCEEDED';
  budget.attempts[budget.attempts.length - 1].actualSeconds = actualSeconds;
  writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
  report.status = 'PASS';
} catch (e) {
  report.error = String(e.message || e);
  // 失败也结算（FAILED）
  if (budget) {
    const last = budget.attempts[budget.attempts.length - 1];
    if (last && last.status === 'DISPATCHING') {
      last.status = 'FAILED';
      last.actualSeconds = last.actualSeconds || 0;
      try {
        writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
      } catch (_) {
        /* ignore */
      }
    }
  }
} finally {
  if (child && child.exitCode === null) {
    try {
      child.kill();
    } catch (_) {
      /* ignore */
    }
  }
  // 受限读清理（幂等）
  if (root) {
    try {
      removeRestrictedReadAll([path.join(root, 'configs')]);
    } catch (_) {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true });
  }
  try {
    closeSync(lock);
    unlinkSync(lockPath);
  } catch (_) {
    /* ignore */
  }
}

import { mkdirSync as mk, writeFileSync as wr } from 'node:fs';
mkdirSync(reportDir, { recursive: true });
const outPath = path.join(reportDir, `exec-restricted-${Date.now()}.json`);
wr(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, 'PASS', 'exec-worker restricted-read integration failed');
