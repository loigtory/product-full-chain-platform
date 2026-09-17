import {
  assertion,
  summarize,
} from '../../server/test-support/gate-result.mjs';
/* 并行/队列压力压测（2 次模型调用）
 * 目标：验证两个不同 req 的 TEXT 作业并发提交时互不干扰——
 *  ① 两个 POST 间隔 <1s 均成功（201）；
 *  ② 两个 ai 作业都到终态 SUCCEEDED（DB real=true）；
 *  ③ 真实并行：A 作业在 B 提交后仍运行（时间重叠），非串行排队；
 *  ④ 无 AGENT_LEASE_LOST/租约冲突/交叉污染。
 * 前置：5199 验收实例、预算充足。
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
  scope: '并行压力压测：双 req TEXT 作业并发互不干扰',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push(assertion(name, !!ok, extra));
  if (!ok) report.errors.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token };

  const targets = [
    { pid: 'R-1088', stage: 'test', name: '跨阶段上下文传递验证' },
    { pid: 'R-1098', stage: 'test', name: 'EXEC+TEXT混合链验证' },
  ];
  // 确认两个 req 都存在
  for (const tg of targets) {
    const r = await (
      await fetch(BASE + '/api/reqs/' + tg.pid, { headers: auth })
    ).json();
    t('目标 req 存在 ' + tg.pid, !r.error, { name: tg.name });
  }

  // 构造两个并发消息（各自带前序 stageContext 种子）
  const jobs = [];
  for (const tg of targets) {
    const msgs = await (
      await fetch(BASE + '/api/reqs/' + tg.pid + '/messages?limit=100', {
        headers: auth,
      })
    ).json();
    const items = msgs.items || [];
    const seeds = [];
    for (const st of ['req', 'design', 'dev']) {
      const cand = items.filter(
        (m) =>
          m.role === 'ai' &&
          m.stage === st &&
          m.status === 'ok' &&
          m.content &&
          m.content.trim(),
      );
      if (cand.length)
        seeds.push({
          stage: st,
          title: st + '阶段产出',
          text: cand[cand.length - 1].content.trim().slice(0, 4000),
        });
    }
    jobs.push({
      ...tg,
      revision: await latestRev(tg.pid, auth),
      stageContext: seeds,
      content:
        '基于前序阶段产出，编制测试策略与用例清单（并行压测）：覆盖主流程、异常边界与验收映射。请引用前序中至少一个具体结论。',
    });
  }

  // 并发提交：A 先发，B 间隔 <1s 后发
  const t0 = Date.now();
  const postA = await fetch(BASE + '/api/reqs/' + jobs[0].pid + '/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      commandId: 'par-a-' + Date.now(),
      expectedRevision: jobs[0].revision,
      stage: jobs[0].stage,
      mode: 'real',
      content: jobs[0].content,
      stageContext: jobs[0].stageContext,
    }),
  });
  const rA = await postA.json();
  t('作业 A 发送成功', postA.ok || postA.status === 201, {
    status: postA.status,
    code: rA?.error?.code,
  });

  await sleep(800);
  const postB = await fetch(BASE + '/api/reqs/' + jobs[1].pid + '/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      commandId: 'par-b-' + Date.now(),
      expectedRevision: jobs[1].revision,
      stage: jobs[1].stage,
      mode: 'real',
      content: jobs[1].content,
      stageContext: jobs[1].stageContext,
    }),
  });
  const rB = await postB.json();
  t('作业 B 发送成功（间隔 <1s）', postB.ok || postB.status === 201, {
    status: postB.status,
    code: rB?.error?.code,
  });
  if (!postA.ok || !postB.ok) return finish();

  const done = { A: null, B: null };
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline && (!done.A || !done.B)) {
    await sleep(10000);
    for (const [k, j] of [
      ['A', jobs[0]],
      ['B', jobs[1]],
    ]) {
      if (done[k]) continue;
      const listResp = await (
        await fetch(BASE + '/api/reqs/' + j.pid + '/messages?limit=50', {
          headers: auth,
        })
      ).json();
      const arr = listResp.items || [];
      const ai = arr
        .filter((m) => m.role === 'ai' && m.stage === j.stage)
        .sort((x, y) => (y.id || '').localeCompare(x.id || ''))[0];
      if (ai && (ai.status === 'ok' || ai.status === 'failed'))
        done[k] = {
          status: ai.status,
          at: Date.now(),
          id: ai.id,
          bytes: ai.content?.length,
        };
    }
  }
  const elapsedA = done.A ? Math.round((done.A.at - t0) / 1000) : null;
  const elapsedB = done.B ? Math.round((done.B.at - t0) / 1000) : null;
  t('作业 A 到达终态', !!done.A && done.A.status === 'ok', {
    elapsedSec: elapsedA,
    status: done.A?.status,
  });
  t('作业 B 到达终态', !!done.B && done.B.status === 'ok', {
    elapsedSec: elapsedB,
    status: done.B?.status,
  });
  if (done.A && done.B) {
    // 真实并行：B 提交（t0+~1s）后 A 仍在运行 → A 终态时间 > B 提交时刻 + 30s
    const bSubmit = t0 + 800;
    t('真实并行（A 在 B 提交后仍运行）', done.A.at > bSubmit + 30000, {
      aFinishAfterBSubmitSec: Math.round((done.A.at - bSubmit) / 1000),
    });
    t(
      '总耗时接近单作业（并行非串行）',
      Math.max(elapsedA, elapsedB) < elapsedA + elapsedB - 60,
      {
        elapsedA,
        elapsedB,
      },
    );
  }

  // DB：两个作业 SUCCEEDED、无 LEASE 错误
  try {
    const { Client } = await import('pg');
    const db = new Client({
      connectionString:
        'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    });
    await db.connect();
    const rr = await db.query(
      `SELECT j.state AS job_state, j.error_code AS job_err, j.kind, r.public_id,
              m.metadata->>'real' AS real_flag, m.status AS msg_status
       FROM "codex_test_ai_tools_20260914_execbrowser".agent_jobs j
       JOIN "codex_test_ai_tools_20260914_execbrowser".reqs r ON r.id=j.req_id
       JOIN "codex_test_ai_tools_20260914_execbrowser".messages m ON m.id::text = j.input->>'aiMessageId'
       WHERE r.public_id IN ($1,$2) ORDER BY j.created_at DESC LIMIT 6`,
      ['R-1088', 'R-1098'],
    );
    await db.end();
    const jobsOk = rr.rows.filter(
      (x) => x.job_state === 'SUCCEEDED' && x.real_flag === 'true',
    );
    const leaseErr = rr.rows.filter((x) => x.job_err === 'AGENT_LEASE_LOST');
    t('DB 两作业 SUCCEEDED + real', jobsOk.length >= 2, {
      succeeded: jobsOk.length,
      rows: rr.rows.length,
    });
    t('无 AGENT_LEASE_LOST / 租约冲突', leaseErr.length === 0, {
      leaseErr: leaseErr.length,
    });
  } catch (e) {
    t('DB 作业终态校验', false, { err: e.message.slice(0, 100) });
  }

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
    'parallel-stress-' + Math.floor(Date.now() / 1000) + '.json',
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
      'parallel-stress-' + Math.floor(Date.now() / 1000) + '.json',
    ),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
