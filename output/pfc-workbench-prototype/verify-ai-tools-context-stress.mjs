import {
  assertion,
  summarize,
} from '../../server/test-support/gate-result.mjs';
/* 超长上下文压测（1 次模型调用）
 * 目标：验证跨阶段 stageContext 的设计约束与长上下文稳定性——
 *  ① 服务端上限 6 条截断（payload 传 7 条）；
 *  ② 单条 text 30000 字符截断（传 ~29900 字符）；
 *  ③ 模型在 ~180KB 长上下文下正常产出（不挂起/不超时/产出引用前序）。
 * 前置：5199 验收实例（execbrowser schema）、预算充足（130/136）。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const BASE = 'http://127.0.0.1:5199';
const REPORT_DIR = resolve(
  projectRoot,
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);
const report = {
  at: new Date().toISOString(),
  status: 'PASS',
  scope:
    '超长上下文压测：stageContext 6 条上限/30000 字符截断/长上下文产出稳定',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push(assertion(name, !!ok, extra));
  if (!ok) report.errors.push(name);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token };

  // 取混合链/全链路验证 req（有 req+design+dev 真实产出）
  const reqs = await (
    await fetch(BASE + '/api/reqs?limit=50', { headers: auth })
  ).json();
  const list = reqs.items || reqs.reqs || [];
  let target = null;
  for (const r of list) {
    if (/混合链|跨阶段/.test(r.name || '')) {
      target = r;
      break;
    }
  }
  if (!target) {
    t('定位混合链 req', false, { note: '未找到' });
    return finish();
  }
  const pid = target.public_id || target.id;
  t('定位混合链 req', true, { pid, name: target.name });

  // 取该 req 已有消息，构造 7 条超长 stageContext（前 6 条真实产出开头+填充，第 7 条应被截掉）
  const msgs = await (
    await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=100', {
      headers: auth,
    })
  ).json();
  const items = msgs.items || [];
  const seedByStage = {};
  for (const m of items) {
    if (
      m.role === 'ai' &&
      m.status === 'ok' &&
      m.content &&
      m.content.trim() &&
      !seedByStage[m.stage]
    ) {
      seedByStage[m.stage] = m.content.trim();
    }
  }
  const stages = ['req', 'design', 'dev', 'test', 'accept', 'release'];
  const pad =
    '（超长上下文压测填充段：产品全链路闭环作业平台要求每个阶段产出可追踪、可复核、可承接下游；本段用于放大上下文体积以验证长文本稳定性。）';
  const stageContext = [];
  for (const st of stages) {
    const seed = (seedByStage[st] || st + '阶段产出摘要').slice(0, 600);
    let text = '【' + st + '阶段真实产出开头】' + seed + '\n';
    while (text.length < 29000) text += pad;
    text = text.slice(0, 29900) + '【压测标记:' + st + '】';
    stageContext.push({ stage: st, title: st + '阶段产出', text });
  }
  // 第 7 条（应被服务端上限截断丢弃）
  stageContext.push({
    stage: 'observe',
    title: 'observe阶段产出',
    text: '【第7条超限标记:observe】' + pad.repeat(10),
  });

  report.external.push({
    req: pid,
    ctxCount: stageContext.length,
    ctxBytes: JSON.stringify(stageContext).length,
    perStageLen: stageContext.map((c) => c.text.length),
  });

  // 发 test 阶段消息（显式 payload.stageContext）
  const msg = {
    commandId: 'stress-longctx-' + Date.now(),
    expectedRevision: null,
    stage: 'test',
    mode: 'real',
    content:
      '基于全部前序阶段产出（含超长上下文），编制本需求的测试策略与用例清单：覆盖主流程、异常边界、契约差异核对（dev 执行摘要中 sub.js 的 (a,b)=>a-b 实现）、验收标准映射。请逐项引用前序材料中的【压测标记】以证明上下文完整接收。',
    stageContext,
  };
  const pre = await (
    await fetch(BASE + '/api/reqs/' + pid, { headers: auth })
  ).json();
  msg.expectedRevision =
    (pre.items || pre.req || pre).revision ?? pre.req?.revision;
  if (msg.expectedRevision == null) {
    const one = await (
      await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=1', {
        headers: auth,
      })
    ).json();
    const it = (one.items || [])[0];
    msg.expectedRevision =
      it?.revision != null ? it.revision : (one.revision ?? 1);
  }

  const sendAt = Date.now();
  const resp = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(msg),
  });
  const body = await resp.json();
  t('消息发送成功（非 409）', resp.ok, {
    status: resp.status,
    code: body?.error?.code,
  });
  if (!resp.ok) {
    report.external.push({
      note: '发送失败即退出，不空等',
      code: body?.error?.code,
    });
    return finish();
  }

  // 轮询到 ai 终态（600s 上限）
  let last = null,
    aiMsg = null;
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const listResp = await (
      await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=50', {
        headers: auth,
      })
    ).json();
    const arr = listResp.items || [];
    const ai = arr
      .filter((m) => m.role === 'ai' && m.stage === 'test')
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''))[0];
    if (ai && (ai.status === 'ok' || ai.status === 'failed')) {
      aiMsg = ai;
      break;
    }
    last = arr.length;
  }
  const elapsed = Math.round((Date.now() - sendAt) / 1000);
  t('test 阶段 ai 作业到达终态（600s 内）', !!aiMsg, { elapsedSec: elapsed });
  if (!aiMsg) {
    report.external.push({ note: '未到达终态', lastMsgCount: last });
    return finish();
  }
  t('ai 终态 ok + real 标记', aiMsg.status === 'ok', {
    status: aiMsg.status,
    real: aiMsg.metadata?.real,
    bytes: aiMsg.content?.length,
  });
  // DB 权威 real 标记（API metadata 形态差异不覆盖 DB 事实）
  try {
    const { Client } = await import('pg');
    const db = new Client({
      connectionString:
        'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    });
    await db.connect();
    const rr = await db.query(
      `SELECT metadata->>'real' AS real_flag, status FROM "codex_test_ai_tools_20260914_execbrowser".messages WHERE id=$1`,
      [aiMsg.id],
    );
    await db.end();
    t(
      'DB 权威 real=true 标记',
      rr.rows[0]?.real_flag === 'true' && rr.rows[0]?.status === 'ok',
      {
        dbReal: rr.rows[0]?.real_flag,
        dbStatus: rr.rows[0]?.status,
      },
    );
  } catch (e) {
    t('DB 权威 real 校验', false, { err: e.message.slice(0, 100) });
  }

  const aiText = aiMsg.content || '';
  t('ai 产出非空', aiText.trim().length > 50, { len: aiText.length });
  // 引用前序（含压测标记）证明长上下文完整接收
  const marked = aiText.includes('压测标记');
  const refs = stages.filter(
    (st) =>
      aiText.includes('【压测标记:' + st + '】') ||
      aiText.includes(st + '阶段产出'),
  );
  t('ai 产出引用前序（含压测标记）', marked || refs.length >= 3, {
    refs: refs.length,
  });

  // DB 直查：job.input 的 stageContext 应被截断为 6 条、每条 ≤30000
  try {
    const { Client } = await import('pg');
    const db = new Client({
      connectionString:
        'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    });
    await db.connect();
    const r = await db.query(
      'SELECT input FROM "codex_test_ai_tools_20260914_execbrowser".agent_jobs WHERE req_id=(SELECT id FROM "codex_test_ai_tools_20260914_execbrowser".reqs WHERE public_id=$1) ORDER BY created_at DESC LIMIT 1',
      [pid],
    );
    await db.end();
    const input = r.rows[0]?.input;
    if (input && Array.isArray(input.stageContext)) {
      t('服务端 stageContext 上限 6 条截断', input.stageContext.length === 6, {
        actual: input.stageContext.length,
      });
      t(
        '单条 text ≤30000 字符截断',
        input.stageContext.every((c) => c.text.length <= 30000),
        {
          lens: input.stageContext.map((c) => c.text.length),
        },
      );
      t(
        '第 7 条（observe）被丢弃',
        !input.stageContext.some((c) => c.stage === 'observe'),
        {},
      );
    } else {
      t('DB 可查 job.input.stageContext', false, {
        note: input ? 'no stageContext' : 'no job',
      });
    }
  } catch (e) {
    t('DB 直查 job.input', false, { err: e.message.slice(0, 120) });
  }

  // 零污染
  const dirty = execSync('git status --porcelain', {
    cwd: projectRoot,
    stdio: 'pipe',
  }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染', !polluted, {});

  return finish();
}

function finish() {
  report.status = summarize(report);
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(
    REPORT_DIR,
    'context-stress-' + Math.floor(Date.now() / 1000) + '.json',
  );
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
    resolve(
      REPORT_DIR,
      'context-stress-' + Math.floor(Date.now() / 1000) + '.json',
    ),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
