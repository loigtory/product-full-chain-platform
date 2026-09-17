import {
  assertion,
  summarize,
} from '../../server/test-support/gate-result.mjs';
/* EXEC + TEXT 混合链验证：req(TEXT) → design(TEXT 带 req) → dev(EXEC 真实执行) → test(TEXT 带 dev 执行结果)
 * 目标：证明"真实开发执行（EXEC 修改代码 + 跑测试）"的结果能作为上下文传给后续 AI 阶段，
 *      且执行产物真实落盘（dev EXEC 后本地复跑 node --test 验证）。
 * 前置：服务已启动且 PFC_ALLOW_STAGE_BYPASS=1；预算剩余 ≥4 次真实调用。
 */
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

{
  console.log(
    JSON.stringify({
      status: 'BLOCKED',
      code: 'LEGACY_TEST_TARGET_NOT_AUTHORIZED',
      next: 'verify-ai-tools-remediation-*',
    }),
  );
  process.exit(2);
}
const projectRoot = 'D:/项目管理/product-full-chain-platform';
const BASE = 'http://127.0.0.1:5188';
const EXEC_WS =
  'D:/项目管理/product-full-chain-platform/.local/ai-tools-live-smoke-20260915/proj';
const REPORT_DIR = resolve(
  projectRoot,
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);
const report = {
  at: new Date().toISOString(),
  status: 'PASS',
  scope:
    'EXEC+TEXT 混合链：req(TEXT)→design(TEXT+req)→dev(EXEC 真实执行)→test(TEXT+dev 执行结果)',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push(assertion(name, !!ok, extra));
  if (!ok) report.errors.push(name);
};

async function waitAiOk(pid, stage, auth) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const list = await (
      await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=60', {
        headers: auth,
      })
    ).json();
    const cand = (list.items || []).find(
      (m) => m.role === 'ai' && m.stage === stage,
    );
    if (cand && cand.status === 'ok') return cand;
    if (cand && cand.status === 'failed') return { failed: cand };
    await new Promise((r) => setTimeout(r, 6000));
  }
  return null;
}

async function realFlagOf(aiId) {
  try {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({
      connectionString:
        'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    });
    const rows = await pool.query(
      'SELECT metadata->>\'real\' AS realflag FROM "codex_test_ai_tools_20260914_execbrowser".messages WHERE public_id=$1',
      [aiId],
    );
    await pool.end();
    return rows.rows[0]?.realflag;
  } catch (e) {
    report.external.push({ step: 'db-real', error: String(e.message || e) });
    return null;
  }
}

async function latestRev(pid, auth) {
  try {
    const cur = await (
      await fetch(BASE + '/api/reqs/' + pid, { headers: auth })
    ).json();
    return cur.req?.revision;
  } catch {
    return null;
  }
}

async function main() {
  // 重置合成项目：删除上次 EXEC 可能产生的 sub.js（sum.js 保持原样）
  const subPath = EXEC_WS + '/sub.js';
  if (existsSync(subPath)) rmSync(subPath);
  report.external.push({ step: 'reset', removedSub: existsSync(subPath) });

  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = {
    Authorization: 'Bearer ' + token,
    'content-type': 'application/json',
  };

  const created = await fetch(BASE + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: 'EXEC+TEXT混合链验证',
      goal: '验证真实开发执行（EXEC 改码+测试）结果可作为上下文传入后续 AI 阶段',
      scope: '真实 TEXT×3 + EXEC×1',
    }),
  });
  const req = (await created.json()).req;
  const pid = req.public_id || req.id;
  t('创建验证 req', !!pid, { pid });

  const confirmed = [];

  // —— 1. req TEXT ——
  let m = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: await latestRev(pid, auth),
      content:
        '请按需求阶段工作法，为「sum 工具库」新增减法能力固化为可作业的需求（功能点、验收标准、范围）。目标项目为本地 Node 工程（sum.js + test/sum.test.js，node:test 框架）。',
      stage: 'req',
      mode: 'real',
    }),
  });
  if (![200, 201, 202].includes(m.status)) return failSend('REQ', m);
  t('REQ 发送 TEXT 作业', true, { status: m.status });
  let ai = await waitAiOk(pid, 'req', auth);
  t('REQ ai 终态 ok', !!(ai && ai.status === 'ok' && !ai.failed), {
    meta: ai?.metadata || null,
  });
  if (!ai || ai.failed || !ai.content || ai.content.trim().length < 30)
    return finish();
  const reqText = ai.content.trim();
  t('REQ 产出非空', reqText.length > 30, { len: reqText.length });
  const reqReal = await realFlagOf(ai.id);
  t('REQ metadata.real=true（DB 直查）', reqReal === 'true', {
    realFlag: reqReal,
  });
  confirmed.push({ stage: 'req', title: '需求分析产出', text: reqText });
  report.external.push({ step: 'req', len: reqText.length });

  // —— 2. design TEXT（带 req） ——
  m = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: await latestRev(pid, auth),
      content:
        '请按设计阶段工作法，基于前序需求结论输出「sum 工具库新增减法」的方案设计：模块划分、接口与实现决策（保持 node:test 风格）。',
      stage: 'design',
      mode: 'real',
      stageContext: confirmed.map((c) => ({
        stage: c.stage,
        title: c.title,
        text: c.text,
      })),
    }),
  });
  if (![200, 201, 202].includes(m.status)) return failSend('DESIGN', m);
  t('DESIGN 发送 TEXT 作业（带 req stageContext）', true, { status: m.status });
  ai = await waitAiOk(pid, 'design', auth);
  t('DESIGN ai 终态 ok', !!(ai && ai.status === 'ok' && !ai.failed), {
    meta: ai?.metadata || null,
  });
  if (!ai || ai.failed || !ai.content || ai.content.trim().length < 30)
    return finish();
  const desText = ai.content.trim();
  t('DESIGN 产出非空', desText.length > 30, { len: desText.length });
  const desReal = await realFlagOf(ai.id);
  t('DESIGN metadata.real=true（DB 直查）', desReal === 'true', {
    realFlag: desReal,
  });
  const desNoClaim =
    !/未提供上一步|未包含上一步|当前(对话|会话)未(提供|包含|包括)上一步/.test(
      desText,
    );
  t('DESIGN 不再声明"未提供上一步内容"', desNoClaim, {});
  confirmed.push({ stage: 'design', title: '方案设计产出', text: desText });
  report.external.push({
    step: 'design',
    len: desText.length,
    snippet: desText.slice(0, 200),
  });

  // —— 3. dev EXEC（真实执行） ——
  m = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: await latestRev(pid, auth),
      content:
        '在指定 workspace 中实现减法能力：新增 sub.js 导出减法函数（module.exports = (a,b) => a - b），在 test/sub.test.js 中补充测试用例，运行 node --test 使全部测试通过。完成后报告修改/新增的文件与测试结果。',
      stage: 'dev',
      mode: 'real',
      tool: 'exec',
      workspace: EXEC_WS,
      restrictedReadDirs: [],
      control: {
        mode: 'strict',
        allowedFiles: ['workspace/**'],
        allowedCommands: ['node --test'],
        maxFiles: 50,
        maxBytes: 2097152,
        approvedBy: 'owner',
      },
    }),
  });
  if (![200, 201, 202].includes(m.status)) return failSend('DEV-EXEC', m);
  t('DEV 发送 EXEC 作业（tool:exec 真实执行）', true, { status: m.status });
  ai = await waitAiOk(pid, 'dev', auth);
  t(
    'DEV-EXEC ai 终态 ok（执行完成回写）',
    !!(ai && ai.status === 'ok' && !ai.failed),
    {
      meta: ai?.metadata || null,
    },
  );
  let devText = null;
  if (
    ai &&
    ai.status === 'ok' &&
    !ai.failed &&
    ai.content &&
    ai.content.trim().length > 0
  ) {
    devText = ai.content.trim();
    t('DEV-EXEC 回写内容非空', devText.length > 30, { len: devText.length });
    const devReal = await realFlagOf(ai.id);
    t('DEV-EXEC metadata.real=true（DB 直查）', devReal === 'true', {
      realFlag: devReal,
    });
  } else {
    t('DEV-EXEC 回写内容非空', false, {});
  }
  // 真实落盘验证：sub.js 存在 + node --test 通过（本地复跑，独立于平台回写）
  let subExists = false;
  let testPass = false;
  let testOut;
  try {
    subExists = existsSync(subPath);
    testOut = execSync('node --test', {
      cwd: EXEC_WS,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000,
    });
    testPass =
      /pass/.test(testOut.toLowerCase()) &&
      !/fail/.test(testOut.toLowerCase().split(' ').slice(0, 40).join(' '));
    // node:test 输出格式：tests 1, pass 1, fail 0
    testPass =
      /tests \d+.*pass \d+.*fail 0/i.test(testOut.replace(/\s+/g, ' ')) ||
      (!/fail \d+/.test(testOut) && /pass \d+/.test(testOut));
  } catch (e) {
    testOut = String(e.message || e);
  }
  t('DEV-EXEC 产物真实落盘（sub.js 存在）', subExists, { subExists });
  t('DEV-EXEC 本地复跑 node --test 通过', testPass, {
    out: testOut.replace(/\s+/g, ' ').slice(0, 160),
  });
  if (devText) {
    confirmed.push({ stage: 'dev', title: '开发执行结果', text: devText });
    report.external.push({
      step: 'dev-exec',
      len: devText.length,
      snippet: devText.slice(0, 300),
    });
  }

  // —— 4. test TEXT（带 req+design+dev EXEC 结果） ——
  m = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: await latestRev(pid, auth),
      content:
        '请按测试阶段工作法，基于前序需求、设计及开发执行结果，输出「sum 工具库新增减法」的测试矩阵：核心用例、场景、预期结果与自动化覆盖标记。',
      stage: 'test',
      mode: 'real',
      stageContext: confirmed.map((c) => ({
        stage: c.stage,
        title: c.title,
        text: c.text,
      })),
    }),
  });
  if (![200, 201, 202].includes(m.status)) return failSend('TEST', m);
  t('TEST 发送 TEXT 作业（带 req+design+dev EXEC 结果 stageContext）', true, {
    status: m.status,
  });
  ai = await waitAiOk(pid, 'test', auth);
  t('TEST ai 终态 ok', !!(ai && ai.status === 'ok' && !ai.failed), {
    meta: ai?.metadata || null,
  });
  if (!ai || ai.failed || !ai.content || ai.content.trim().length < 30)
    return finish();
  const testText = ai.content.trim();
  t('TEST 产出非空', testText.length > 30, { len: testText.length });
  const testReal = await realFlagOf(ai.id);
  t('TEST metadata.real=true（DB 直查）', testReal === 'true', {
    realFlag: testReal,
  });
  const testNoClaim =
    !/未提供上一步|未包含上一步|当前(对话|会话)未(提供|包含|包括)上一步/.test(
      testText,
    );
  t('TEST 不再声明"未提供上一步内容"', testNoClaim, {});
  // 核心：test 引用 dev EXEC 真实执行结果（sub/减法/node --test/测试通过 等执行证据词）
  const citesExec =
    /sub\.js|减法|node --test|测试通过|已通过|已执行|执行结果|新增.*测试|测试矩阵.*(依据|基于|根据).*执行/.test(
      testText,
    );
  t('TEST 产出引用 dev EXEC 执行结果（sub/减法/测试通过）', citesExec, {
    citesExec,
  });
  report.external.push({
    step: 'test',
    len: testText.length,
    snippet: testText.slice(0, 300),
  });

  // —— 零污染 ——
  const dirty = execSync('git status --porcelain', {
    cwd: projectRoot,
    stdio: 'pipe',
  }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染（server/apps/packages 无改动）', !polluted, {
    dirty: dirty.split(/\r?\n/).filter(Boolean).slice(0, 6),
  });
  report.external.push({
    chainConfirmed: confirmed.map((c) => c.stage + ':' + c.text.length + 'B'),
  });

  return finish();
}

async function failSend(tag, m) {
  let body = '';
  try {
    body = JSON.stringify(await m.json());
  } catch {
    /* Non-authoritative diagnostic/readiness output cannot establish success. */
  }
  t(tag + ' 发送作业', false, { status: m.status, body });
  report.external.push({ step: tag + '-send', status: m.status, body });
  return finish();
}

function finish() {
  report.status = summarize(report);
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(
    REPORT_DIR,
    'mixed-chain-' + Math.floor(Date.now() / 1000) + '.json',
  );
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file: out,
      errors: report.errors,
      external: report.external.length,
    }),
  );
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  report.errors.push('UNCAUGHT: ' + e.message);
  report.status = 'FAIL';
  writeFileSync(
    resolve(
      REPORT_DIR,
      'mixed-chain-' + Math.floor(Date.now() / 1000) + '.json',
    ),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
