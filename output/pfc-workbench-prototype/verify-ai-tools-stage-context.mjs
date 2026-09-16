/* 跨阶段上下文传递验证：req（真实产出）→ design（携带 stageContext 注入前序产出）
 * 前置：服务已启动且 PFC_ALLOW_STAGE_BYPASS=1；预算剩余 ≥2 次真实调用。
 * 断言：req/design 均 ai 终态 ok + metadata.real=true；
 *       design 产出不再声明"未提供上一步内容"（旧独立线程边界），
 *       且产出引用/基于前序需求结论继续（上下文注入生效）。
 */
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = 'D:/项目管理/product-full-chain-platform';
const BASE = 'http://127.0.0.1:5188';
const REPORT_DIR = resolve(projectRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914');
const report = {
  at: new Date().toISOString(),
  status: 'PASS',
  scope: '跨阶段上下文传递：req 真实产出经 stageContext 注入 design',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...(extra || {}) });
  if (!ok) report.errors.push(name);
};

async function waitAiOk(pid, stage, auth) {
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    const list = await (
      await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=50', { headers: auth })
    ).json();
    const cand = (list.items || []).find((m) => m.role === 'ai' && m.stage === stage);
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
      "SELECT metadata->>'real' AS realflag FROM \"codex_test_ai_tools_20260914_execbrowser\".messages WHERE public_id=$1",
      [aiId],
    );
    await pool.end();
    return rows.rows[0]?.realflag;
  } catch (e) {
    report.external.push({ step: 'db-real', error: String(e.message || e) });
    return null;
  }
}

async function main() {
  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  const created = await fetch(BASE + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '跨阶段上下文传递验证',
      goal: '验证 req 真实产出经 stageContext 注入 design 阶段（跨阶段上下文闭环）',
      scope: '真实 TEXT 作业 ×2',
    }),
  });
  const req = (await created.json()).req;
  const pid = req.public_id || req.id;
  t('创建验证 req', !!pid, { pid });

  // —— 第一步：req 阶段真实产出 ——
  let rev = req.revision;
  const cur1 = await (await fetch(BASE + '/api/reqs/' + pid, { headers: auth })).json();
  rev = cur1.req?.revision ?? rev;
  const m1 = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: rev,
      content:
        '基于上一步澄清：请按需求阶段工作法，把「依赖与安全扫描」能力固化为可作业的需求（功能点、优先级、验收标准、范围与待确认项）。',
      stage: 'req',
      mode: 'real',
    }),
  });
  if (![200, 201, 202].includes(m1.status)) {
    let body = '';
    try { body = JSON.stringify(await m1.json()); } catch {}
    t('req 发送 TEXT 作业', false, { status: m1.status, body });
    report.external.push({ step: 'req-send', status: m1.status, body });
    return finish();
  }
  t('req 发送 TEXT 作业', true, { status: m1.status });
  const reqAi = await waitAiOk(pid, 'req', auth);
  t('req ai 终态 ok', !!(reqAi && reqAi.status === 'ok' && !reqAi.failed), {
    meta: reqAi?.metadata || (reqAi && reqAi.failed ? reqAi.failed.metadata : null),
  });
  if (!reqAi || reqAi.failed || !reqAi.content || reqAi.content.trim().length < 30) return finish();
  const reqText = reqAi.content.trim();
  t('req 产出非空', reqText.length > 30, { len: reqText.length });
  const reqReal = await realFlagOf(reqAi.id);
  t('req metadata.real=true（DB 直查）', reqReal === 'true', { realFlag: reqReal });
  report.external.push({ step: 'req', ai: { id: reqAi.id, len: reqText.length, snippet: reqText.slice(0, 240) } });

  // —— 第二步：design 阶段携带 stageContext（req 产出全文） ——
  const cur2 = await (await fetch(BASE + '/api/reqs/' + pid, { headers: auth })).json();
  rev = (cur2.req?.revision ?? rev) + 1; // 上一步发送后 revision 已递增，从最新再校验
  const cur2b = await (await fetch(BASE + '/api/reqs/' + pid, { headers: auth })).json();
  rev = cur2b.req?.revision ?? rev;
  const m2 = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: rev,
      content:
        '请按设计阶段工作法，基于前序需求结论输出「依赖与安全扫描」的方案设计：整体架构、模块划分、关键接口与设计决策。',
      stage: 'design',
      mode: 'real',
      stageContext: [{ stage: 'req', title: '需求分析产出', text: reqText }],
    }),
  });
  if (![200, 201, 202].includes(m2.status)) {
    let body = '';
    try { body = JSON.stringify(await m2.json()); } catch {}
    t('design 发送 TEXT 作业（带 stageContext）', false, { status: m2.status, body });
    report.external.push({ step: 'design-send', status: m2.status, body });
    return finish();
  }
  t('design 发送 TEXT 作业（带 stageContext）', true, { status: m2.status });
  const desAi = await waitAiOk(pid, 'design', auth);
  t('design ai 终态 ok', !!(desAi && desAi.status === 'ok' && !desAi.failed), {
    meta: desAi?.metadata || (desAi && desAi.failed ? desAi.failed.metadata : null),
  });
  if (!desAi || desAi.failed || !desAi.content || desAi.content.trim().length < 30) return finish();
  const desText = desAi.content.trim();
  t('design 产出非空', desText.length > 30, { len: desText.length });
  const desReal = await realFlagOf(desAi.id);
  t('design metadata.real=true（DB 直查）', desReal === 'true', { realFlag: desReal });

  // 核心断言：上下文注入生效
  const noUpstreamClaim = !/未提供上一步|未包含上一步|当前(对话|会话)未|未提供.*(需求|上一步)|没有.*上一步/.test(desText);
  t('design 不再声明"未提供上一步内容"（旧独立线程边界消除）', noUpstreamClaim, {
    hasClaim: !noUpstreamClaim,
  });
  const citesUpstream = /前序|上一步|上文|前述|上述需求|基于.*需求|根据.*需求|结合.*需求|依据.*需求/.test(desText);
  t('design 产出引用/基于前序需求结论继续', citesUpstream, { citesUpstream });
  // 观察项：是否承接 req 的关键内容词（功能点/验收标准/优先级）
  const inherits = /功能点|验收标准|优先级|范围|待确认/.test(desText);
  report.external.push({
    step: 'design',
    ai: { id: desAi.id, len: desText.length, snippet: desText.slice(0, 300) },
    inheritsReqKeywords: inherits,
  });
  t('design 承接需求关键词（功能点/验收/优先级/范围）', inherits, { inherits });

  // —— 零污染 ——
  const dirty = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染（server/apps/packages 无改动）', !polluted, {
    dirty: dirty.split(/\r?\n/).filter(Boolean).slice(0, 6),
  });

  return finish();
}

function finish() {
  report.status = report.tests.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS';
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(REPORT_DIR, 'stage-context-' + Math.floor(Date.now() / 1000) + '.json');
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
    resolve(REPORT_DIR, 'stage-context-' + Math.floor(Date.now() / 1000) + '.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
