/* 前端自动附加 stageContext 逻辑等价验证（零模型预算）
 * 目标：8.17 三件套中"前端 domain-conversation.js 自动附加前序产出"从未被独立验证
 *      （8.17/8.18/8.19 均为脚本显式传 stageContext）。
 * 方式：① 用真实 DB/API 消息构造前端视角 q.messages；② 执行与前端源码逐字一致的收集算法；
 *      ③ 断言：仅取前序阶段、每阶段最近一条 ai ok 产出、顺序正确、text 非空截断；
 *      ④ 源码存在性检查（防止前端逻辑漂移/被删）。
 * 前置：5188 服务运行（只读 GET，不消耗模型预算）。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = 'D:/项目管理/product-full-chain-platform';
const BASE = 'http://127.0.0.1:5188';
const REPORT_DIR = resolve(projectRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914');
const FRONTEND_SRC = resolve(projectRoot, 'output/pfc-workbench-prototype/original/domain-conversation.js');
const report = {
  at: new Date().toISOString(),
  status: 'PASS',
  scope: '前端自动附加 stageContext 逻辑等价验证（零模型预算）',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...(extra || {}) });
  if (!ok) report.errors.push(name);
};

// —— 与 domain-conversation.js 逐字一致的收集算法 ——
function collectStageContext(q, stage) {
  const _stageOrder = ['idea', 'req', 'design', 'dev', 'test', 'accept', 'release', 'observe'];
  const _curIdx = _stageOrder.indexOf(stage);
  let _stageContext = [];
  if (_curIdx > 0 && Array.isArray(q.messages)) {
    for (const _st of _stageOrder.slice(0, _curIdx)) {
      const _cands = q.messages
        .filter(
          (m) =>
            m.role === 'ai' &&
            m.stage === _st &&
            m.status === 'ok' &&
            m.content &&
            String(m.content).trim(),
        )
        .sort((a, b) =>
          String(b.updatedAt || b.createdAt || '').localeCompare(
            String(a.updatedAt || a.createdAt || ''),
          ),
        );
      if (_cands[0]) {
        _stageContext.push({
          stage: _st,
          title: _st + '阶段产出',
          text: String(_cands[0].content).trim().slice(0, 30000),
        });
      }
    }
  }
  return _stageContext;
}

async function main() {
  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token };

  // 取最近一个含多阶段 ai ok 产出的 req（优先全链路/混合链验证 req）
  const reqs = await (await fetch(BASE + '/api/reqs?limit=50', { headers: auth })).json();
  const list = reqs.items || reqs.reqs || [];
  let target = null;
  for (const r of list) {
    if (/跨阶段|混合链|全链路/.test(r.name || '')) {
      target = r;
      break;
    }
  }
  if (!target) {
    t('定位含多阶段产出的验证 req', false, { note: '未找到' });
    return finish();
  }
  const pid = target.public_id || target.id;
  t('定位含多阶段产出的验证 req', true, { pid, name: target.name });

  const msgs = await (
    await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=100', { headers: auth })
  ).json();
  const items = msgs.items || [];
  const q = { messages: items };
  const byStage = {};
  for (const m of items) {
    (byStage[m.stage] = byStage[m.stage] || []).push(m);
  }
  report.external.push({
    req: pid,
    stageCount: Object.keys(byStage).join(','),
    msgCount: items.length,
  });

  // —— 断言 1：design 阶段自动附加 req 最近产出 ——
  const ctxDesign = collectStageContext(q, 'design');
  const reqOk = (byStage['req'] || []).filter((m) => m.status === 'ok' && m.content && String(m.content).trim());
  const expectReq = reqOk.length
    ? String(reqOk[reqOk.length - 1].content).trim()
    : null;
  t('design 自动附加 req 阶段产出', ctxDesign.some((c) => c.stage === 'req'), {
    ctxStages: ctxDesign.map((c) => c.stage),
  });
  t('附加的 req 产出=该阶段最近一条 ai ok（非空）', !!expectReq && ctxDesign.find((c) => c.stage === 'req')?.text === expectReq, {
    len: expectReq ? expectReq.length : 0,
  });
  t('design 只附加前序（不附加自身/后续阶段）', ctxDesign.every((c) => ['req'].includes(c.stage)), {});

  // —— 断言 2：dev 阶段自动附加 req+design ——
  const ctxDev = collectStageContext(q, 'dev');
  t('dev 自动附加 req+design 两条前序', ['req', 'design'].every((s) => ctxDev.some((c) => c.stage === s)), {
    ctxStages: ctxDev.map((c) => c.stage),
  });
  t('dev 附加顺序按阶段序（req 在前）', ctxDev.map((c) => c.stage).join(',') === 'req,design', {});

  // —— 断言 3：test 阶段自动附加 req+design+dev（若存在） ——
  const ctxTest = collectStageContext(q, 'test');
  const expectStages = ['req', 'design', 'dev'].filter((s) => (byStage[s] || []).some((m) => m.status === 'ok' && m.content && String(m.content).trim()));
  t('test 自动附加全部有产出的前序阶段', expectStages.length === ctxTest.length && expectStages.every((s) => ctxTest.some((c) => c.stage === s)), {
    expect: expectStages,
    actual: ctxTest.map((c) => c.stage),
  });

  // —— 断言 4：req 阶段（首阶段）不附加任何 stageContext ——
  const ctxReq = collectStageContext(q, 'req');
  t('首阶段 req 不附加 stageContext（无前序）', ctxReq.length === 0, { len: ctxReq.length });

  // —— 断言 5：跳过 failed/非 ok 消息 ——
  // 构造一个含 failed 消息的模拟 q，确认算法跳过
  const mock = {
    messages: [
      { role: 'ai', stage: 'req', status: 'failed', content: 'x' },
      { role: 'ai', stage: 'req', status: 'ok', content: '  有效产出  ' },
    ],
  };
  const ctxMock = collectStageContext(mock, 'design');
  t('算法跳过 failed、取最近 ok 并 trim', ctxMock.length === 1 && ctxMock[0].text === '有效产出', {
    text: ctxMock[0]?.text,
  });

  // —— 断言 6：源码存在性（防止前端逻辑漂移） ——
  const src = readFileSync(FRONTEND_SRC, 'utf8');
  const hasLogic = src.includes('_stageOrder') && src.includes('stageContext: _stageContext') && src.includes('_stageOrder.slice(0, _curIdx)');
  t('前端源码仍包含自动附加逻辑（防漂移）', hasLogic, {});

  // —— 零污染 ——
  const dirty = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染', !polluted, {});

  return finish();
}

function finish() {
  report.status = report.tests.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS';
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(REPORT_DIR, 'frontend-stagecontext-' + Math.floor(Date.now() / 1000) + '.json');
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file: out,
      errors: report.errors,
    }),
  );
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  report.errors.push('UNCAUGHT: ' + e.message);
  report.status = 'FAIL';
  writeFileSync(
    resolve(REPORT_DIR, 'frontend-stagecontext-' + Math.floor(Date.now() / 1000) + '.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
