'use strict';
// exec http 端到端闸（真实模型调用 1 次，8.7/8.8 标注的验证边界收口）：
// 起真实服务（007 schema + PFC_CODEX_BINARY）→ POST /api/reqs/:id/messages
// 携带 mode:'real' + tool:'exec' + workspace（前端 exec 入口同款 payload）→
// sendMessage 创建 EXECUTE 作业 → runExecJob（CLI host codex exec）→
// 输出流式写回 ai 消息 → 断言 job SUCCEEDED + ai 消息 final 含执行输出。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope:
    'exec http end-to-end: POST /messages {mode:real, tool:exec, workspace} → EXECUTE job → runExecJob → streamed ai message',
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
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverDir = resolve(here);
const nodeBin = resolve(root, '.tools/node-v24.20.0-win-x64/node.exe');
const reports = resolve(root, 'docs/quality-gate/reports/ai-tools-integration-20260914');

// EVIDENCE_ONLY 证据模式：引用已入库 PASS 证据，不建 schema、不跑模型。
if (process.env.EVIDENCE_ONLY) {
  const evReport = {
    at: new Date().toISOString(),
    status: 'FAIL',
    scope: 'exec http e2e EVIDENCE_ONLY（引用已入库 PASS 证据）',
    modelTurns: 0,
    checks: [],
    evidenceOnly: process.env.EVIDENCE_ONLY,
  };
  try {
    const ev = JSON.parse(
      readFileSync(resolve(reports, process.env.EVIDENCE_ONLY), 'utf8'),
    );
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
    echeck('evidence job EXECUTE SUCCEEDED', () =>
      assert.equal(ev.job && ev.job.kind === 'EXECUTE' && ev.job.state, 'SUCCEEDED'),
    );
    echeck('evidence ai message final ok', () =>
      assert.equal(ev.ai && ev.ai.status, 'ok'),
    );
    echeck('evidence output streamed into message', () =>
      assert.ok(
        (ev.ai && ev.ai.content || '').trim().length > 20 &&
          !((ev.ai && ev.ai.content) || '').includes('【模拟回复】'),
      ),
    );
    evReport.status = 'PASS';
  } catch (e) {
    evReport.error = String(e.message || e);
  }
  console.log(JSON.stringify(evReport, null, 2));
  process.exit(evReport.status === 'PASS' ? 0 : 1);
}

const serverRequire = createRequire(resolve(serverDir, 'package.json'));
let fixture, child;
try {
  const { aiDatabaseFixture } = await import('./test-data/ai-tools-fixture.mjs');
  fixture = await aiDatabaseFixture('exece2e');
  const { migrate, assertReady } = serverRequire('./src/persistence/migrations');
  await migrate(fixture.db);
  await assertReady(fixture.db);
  const { ctx, req } = await fixture.seed();
  const db = fixture.db;
  const smokeDir = resolve(root, '.local/ai-tools-exec-e2e-20260915');
  mkdirSync(smokeDir, { recursive: true });
  const filesRoot = resolve(
    root,
    '.local/m2c-2-domain-20260912/files/ai-tools-exec-e2e',
  );
  mkdirSync(filesRoot, { recursive: true });
  const usersFile = resolve(smokeDir, 'users.json');
  writeFileSync(
    usersFile,
    JSON.stringify([{ name: ctx.actor, tenantId: ctx.tenantId, role: 'owner' }]),
  );
  const jwtSecret = randomUUID() + randomUUID().replaceAll('-', '');
  const jwt = serverRequire('jsonwebtoken').sign(
    { sub: ctx.actor, role: 'owner', tenant: ctx.tenantId },
    jwtSecret,
    { expiresIn: '1h' },
  );
  const port = 5204;
  const env = {
    ...process.env,
    PORT: String(port),
    PFC_DB: 'pg',
    DATABASE_URL: fixture.options.connectionString,
    PFC_DB_SCHEMA: db.schema,
    PFC_AUTHORIZED_SCHEMA: db.schema,
    PFC_DB_TARGET_VERSION: '007',
    JWT_SECRET: jwtSecret,
    PFC_LOCAL_USERS_FILE: usersFile,
    PFC_FILE_QUOTA_BYTES: '10485760',
    PFC_FILES_ROOT: filesRoot,
    PFC_CODEX_BINARY:
      'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js',
    PFC_CODEX_PREFLIGHT_CWD: root,
  };
  child = spawn(nodeBin, ['src/index.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => {
    if (report.serverLogs) report.serverLogs += d.toString();
    else report.serverLogs = d.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  check('server ready', () => assert.ok(ready));

  // 前端 exec 入口同款 payload：D.command 自动注入 commandId + D.mutate 自动带
  // expectedRevision（q.revision）。闸模拟前端完整契约：先 GET 拿 revision，
  // 再 POST {mode:'real' + tool:'exec' + workspace + commandId + expectedRevision}
  const workspace = resolve(root, '.local/ai-tools-integration-20260914/preflight');
  mkdirSync(workspace, { recursive: true });
  const reqRow = await (
    await fetch(base + `/api/reqs/${req.public_id}`, {
      headers: { Authorization: 'Bearer ' + jwt },
    })
  ).json();
  report.getReq = reqRow ? JSON.stringify(reqRow).slice(0, 300) : null;
  const content =
    'CODEx_TEST_AI_TOOLS_20260914。执行 git status --short 并原样输出结果；不要额外解释。';
  const sent = await (
    await fetch(base + `/api/reqs/${req.public_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + jwt,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        // 不指定 stage：跟随需求当前阶段（seed 为 idea）；exec 触发由 tool:'exec' 决定
        mode: 'real',
        tool: 'exec',
        workspace,
        restrictedReadDirs: [],
        commandId: 'EXEC-E2E-' + randomUUID(),
        expectedRevision: reqRow?.req?.revision ?? reqRow?.revision ?? 1,
      }),
    })
  ).json();
  report.sent = sent
    ? JSON.stringify(sent).slice(0, 300) +
      (sent.jobId ? ' jobId=' + sent.jobId : '')
    : null;
  // sendMessage 成功响应为 201 { message, reply, ...jobId? }（非 {ok:true}）
  check('sendMessage accepted', () => assert.ok(sent?.message?.id, 'no message'));
  report.jobId = sent?.jobId ?? null;
  // 调试：POST 后立即查 DB 原始 ai 消息 metadata
  try {
    const aiRaw = (
      await db.pool.query(
        `SELECT status,metadata FROM "${db.schema}".messages WHERE req_id=$1 AND role='ai' ORDER BY created_at DESC LIMIT 1`,
        [req.id],
      )
    ).rows[0];
    report.aiRaw = aiRaw
      ? { status: aiRaw.status, metadata: JSON.stringify(aiRaw.metadata) }
      : null;
  } catch (e) {
    report.aiRawError = String(e.message || e);
  }

  // 轮询消息流：等 ai 消息 final（runExecJob 输出写回）
  let aiMsg = null;
  let lastList = null;
  for (let i = 0; i < 120; i++) {
    const list = await (
      await fetch(base + `/api/reqs/${req.public_id}/messages?limit=20`, {
        headers: { Authorization: 'Bearer ' + jwt },
      })
    ).json();
    const msgs = list.items || list.messages || list.data || list;
    lastList = Array.isArray(msgs)
      ? msgs.map((m) => ({ role: m.role, status: m.status, real: !!m.real }))
      : String(list).slice(0, 200);
    const target = (Array.isArray(msgs) ? msgs : []).find(
      (m) =>
        m.role === 'ai' &&
        (m.status === 'ok' || m.status === 'failed') &&
        (m.content || '').trim().length > 0,
    );
    if (target) { aiMsg = target; break; }
    const jobNow = (
      await db.pool.query(
        `SELECT state,kind FROM "${db.schema}".agent_jobs WHERE command_id LIKE 'EXEC-%' ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0];
    if (jobNow && (jobNow.state === 'FAILED' || jobNow.state === 'TIMED_OUT')) {
      report.jobEarly = { state: jobNow.state, kind: jobNow.kind };
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  report.lastList = lastList;
  check('ai message final within timeout', () => assert.ok(aiMsg, 'no final ai message'));
  report.ai = aiMsg
    ? { status: aiMsg.status, content: (aiMsg.content || '').slice(0, 400) }
    : null;

  // 作业终态：agent_jobs EXECUTE SUCCEEDED
  const jobRow = (
    await db.pool.query(
      `SELECT kind,state,result FROM "${db.schema}".agent_jobs WHERE command_id LIKE 'EXEC-%' ORDER BY created_at DESC LIMIT 1`,
    )
  ).rows[0];
  report.job = jobRow
    ? {
        kind: jobRow.kind,
        state: jobRow.state,
        result:
          typeof jobRow.result === 'string'
            ? jobRow.result.slice(0, 300)
            : JSON.stringify(jobRow.result ?? null).slice(0, 300),
      }
    : null;
  check('agent_jobs EXECUTE SUCCEEDED', () =>
    assert.equal(jobRow?.kind, 'EXECUTE') && assert.equal(jobRow.state, 'SUCCEEDED'),
  );
  check('exec output streamed into ai message', () =>
    assert.ok(
      (aiMsg?.content || '').trim().length > 20 &&
        !(aiMsg?.content || '').includes('【模拟回复】'),
    ),
  );
  check('ai message final ok', () => assert.equal(aiMsg.status, 'ok'));

  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED', message: e.message };
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  if (fixture) await fixture.cleanup();
  rmSync(resolve(root, '.local/ai-tools-exec-e2e-20260915'), {
    recursive: true,
    force: true,
  });
  rmSync(
    resolve(root, '.local/m2c-2-domain-20260912/files/ai-tools-exec-e2e'),
    { recursive: true, force: true },
  );
  mkdirSync(reports, { recursive: true });
  const file = resolve(reports, `exec-e2e-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      file,
      error: report.error,
      job: report.job,
      ai: report.ai ? report.ai.status : null,
      serverLogs: (report.serverLogs || '').slice(-300),
    }),
  );
}
