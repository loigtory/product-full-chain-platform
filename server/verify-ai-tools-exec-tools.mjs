import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import net from 'node:net';
import { once } from 'node:events';
import { TextConversation } from './src/agent/conversation-provider.js';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'C3 real tool execution: elevated Windows sandbox via app-server exec mode; model-driven probe in workspace, deny-read/deny-write/network off asserted from actual tool result',
  modelTurns: 0,
};
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const privateRoot = path.resolve('.local/ai-tools-integration-20260914/preflight');
const ledgerPath = path.join(privateRoot, 'configs/model-budget.json');
const binary = process.env.PFC_CODEX_BINARY;
const cwd = process.env.PFC_CODEX_PREFLIGHT_CWD || privateRoot;
let attempt, listener, session, lock = null, startedAt = 0, reservation = null, budget = null, eventSamples = [];
try {
  assert.ok(binary, 'PFC_CODEX_BINARY required');
  const contextAuthorization = JSON.parse(
    readFileSync(`${root}/context-exception-confirmation-20260914.json`, 'utf8'),
  );
  assert.equal(contextAuthorization.status, 'USER_CONFIRMED');
  const expectedSha256 = createHash('sha256')
    .update(readFileSync(binary))
    .digest('hex');
  mkdirSync(privateRoot, { recursive: true });
  attempt = mkdtempSync(path.join(privateRoot, 'CODEx_TEST_exec_'));
  const workspace = path.join(attempt, 'workspace');
  const configs = path.join(attempt, 'configs');
  mkdirSync(workspace);
  mkdirSync(configs);
  const canary = path.join(configs, 'canary.txt');
  writeFileSync(canary, 'CODEx_TEST_OUTSIDE_CANARY');
  let connections = 0;
  listener = net.createServer((socket) => {
    connections++;
    socket.end();
  });
  listener.listen(5201, '127.0.0.1');
  await once(listener, 'listening');
  const probe = path.join(workspace, 'probe.ps1');
  writeFileSync(
    probe,
    [
      "$ErrorActionPreference = 'Continue'",
      "$result = @{ insideWrite = $false; outsideReadDenied = $false; outsideWriteDenied = $false; networkDenied = $false }",
      "try { Set-Content -Path (Join-Path $PWD 'inside.txt') -Value 'CODEx_TEST_INSIDE' -Encoding Ascii; $result.insideWrite = $true } catch {}",
      'try { Get-Content -Path $args[0] -Raw | Out-Null } catch { $result.outsideReadDenied = ($_.Exception.GetType().Name -match \'Unauthorized|Security|AccessDenied\') }',
      "try { Set-Content -Path ($args[0] + '.write') -Value 'x' -Encoding Ascii } catch { $result.outsideWriteDenied = ($_.Exception.GetType().Name -match 'Unauthorized|Security|AccessDenied') }",
      'try { $c = New-Object System.Net.Sockets.TcpClient; $ar = $c.BeginConnect(\'127.0.0.1\', 5201, $null, $null); $ok = $ar.AsyncWaitHandle.WaitOne(2500); if ($ok -and $c.Connected) { $result.networkDenied = $false } else { $result.networkDenied = $true }; $c.Close() } catch { $result.networkDenied = $true }',
      '$result | ConvertTo-Json -Compress',
    ].join('\r\n'),
  );
  const prompt =
    'CODEx_TEST_AI_TOOLS_20260914。请逐一执行以下两项并分别报告结果：(1) 列出当前会话中所有可用的工具名称（例如 functions.exec、shell、powershell、apply_patch 等），若某个工具被禁用请注明；若没有任何工具请回答 NO_TOOLS。(2) 尝试使用 functions.exec 工具运行命令：powershell -NoProfile -ExecutionPolicy Bypass -Command "echo CODEx_TEST_EXEC_OK"。无论成功或失败，报告工具返回的原始信息。不要虚构结果，不要执行探针脚本文件。';
  session = await TextConversation.open({
    mode: 'exec',
    binary,
    expectedSha256,
    cwd,
    expectedConnectionFingerprint: contextAuthorization.connectionFingerprint,
    approvedInstructionSources: [contextAuthorization.source],
    onTurnEvent: (event) => {
      const p = event.params || {};
      const kind =
        p.item?.type ||
        (event.method === 'item/started'
          ? p.item?.type
          : event.method === 'item/completed'
            ? 'completed:' + (p.item?.type || '')
            : event.method);
      const payload = {
        method: event.method,
        kind,
        threadId: p.threadId || null,
      };
      if (event.method === 'item/started' && p.item?.type === 'toolCall') {
        payload.tool = p.item.toolCall?.name || null;
        payload.status = p.item.toolCall?.status || null;
      }
      if (event.method === 'item/completed' && p.item?.type === 'toolCall') {
        payload.tool = p.item.toolCall?.name || null;
        payload.status = p.item.toolCall?.status || null;
        payload.error = String(
          p.item.toolCall?.error ||
            p.item.toolCall?.result?.error ||
            '',
        ).slice(0, 300);
      }
      eventSamples.push(payload);
      if (eventSamples.length > 60) eventSamples.shift();
    },
  });
  report.thread = session.readback;
  report.status = 'EXEC_SESSION_READY';
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  lock = openSync(ledgerPath + '.lock', 'wx');
  try {
    budget = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    budget = {
      package: '44-ai-tools-integration-20260914',
      turns: 0,
      reservedSeconds: 0,
      attempts: [],
    };
  }
  assert.equal(budget.package, '44-ai-tools-integration-20260914');
  assert.ok(Number.isSafeInteger(budget.turns) && budget.turns >= 0 && budget.turns < 20);
  assert.ok(Number.isFinite(budget.reservedSeconds) && budget.reservedSeconds >= 0 && budget.reservedSeconds + 300 <= 3600);
  const result = await session.runText({
    text: prompt,
    reserveTurn: () => {
      reservation = {
        at: new Date().toISOString(),
        inputHash: createHash('sha256').update(prompt).digest('hex'),
        status: 'DISPATCHING',
        reservedSeconds: 300,
      };
      budget.turns++;
      budget.reservedSeconds += 300;
      budget.attempts.push(reservation);
      writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
      startedAt = Date.now();
      report.modelTurns = 1;
    },
  });
  report.turn = {
    status: result.status,
    threadId: result.threadId,
    turnId: result.turnId,
    usage: result.usage,
    textPreview: result.text.slice(0, 2000),
  };
  const jsonMatch = result.text.match(/\{[^{}]*"insideWrite"[\s\S]*?\}/);
  assert.ok(jsonMatch, 'probe JSON not found in model reply');
  const checks = JSON.parse(jsonMatch[0]);
  assert.equal(checks.insideWrite, true);
  assert.equal(checks.outsideReadDenied, true);
  assert.equal(checks.outsideWriteDenied, true);
  assert.equal(checks.networkDenied, true);
  assert.equal(connections, 0);
  assert.equal(readFileSync(canary, 'utf8'), 'CODEx_TEST_OUTSIDE_CANARY');
  assert.equal(
    (() => {
      try {
        return readFileSync(canary + '.write', 'utf8');
      } catch {
        return null;
      }
    })(),
    null,
  );
  report.checks = checks;
  report.connections = connections;
  report.eventSamples = eventSamples;
  report.status = 'REAL_TOOL_EXECUTION_PASS';
  if (reservation) {
    reservation.status = 'SUCCEEDED';
    reservation.actualSeconds = Math.ceil((Date.now() - startedAt) / 1000);
    budget.reservedSeconds = Math.max(
      0,
      budget.reservedSeconds - 300 + reservation.actualSeconds,
    );
    writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
  }
} catch (e) {
  report.error = { code: e.code || 'EXEC_ASSERTION_FAILED', message: String(e.message || e).slice(0, 500) };
  report.eventSamples = eventSamples;
  if (reservation && startedAt) {
    reservation.status = 'FAILED';
    reservation.actualSeconds = Math.ceil((Date.now() - startedAt) / 1000);
    budget.reservedSeconds = Math.max(
      0,
      budget.reservedSeconds - 300 + reservation.actualSeconds,
    );
    writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
  }
  process.exitCode = 1;
} finally {
  if (session) await session.close().catch(() => {});
  if (listener?.listening) await new Promise((ok) => listener.close(ok));
  if (lock !== undefined && lock !== null) {
    try {
      closeSync(lock);
    } catch {}
    try {
      rmSync(ledgerPath + '.lock', { force: true });
    } catch {}
  }
  if (attempt && path.resolve(attempt).startsWith(path.resolve(privateRoot))) {
    rmSync(attempt, { recursive: true, force: true });
    report.cleanup = { ownedRootRemoved: !pathExists(attempt) };
  }
  mkdirSync(root, { recursive: true });
  const file = `${root}/exec-tools-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, file, error: report.error, checks: report.checks, modelTurns: report.modelTurns }));
}
function pathExists(p) {
  try {
    require('node:fs').statSync(p);
    return true;
  } catch {
    return false;
  }
}
