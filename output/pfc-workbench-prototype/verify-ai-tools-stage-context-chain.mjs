import {
  assertion,
  summarize,
} from '../../server/test-support/gate-result.mjs';
/* 跨阶段上下文传递·全链路验证：req → design → dev → test → release → observe
 * 每步携带前序全部阶段已确认产出（stageContext），验证上下文沿链路逐级传递。
 * 断言：每步 ai 终态 ok + metadata.real=true + 非空 +
 *      不再声明"未提供上一步内容"（旧独立线程边界消除）+ 产出引用/承接前序结论。
 * 前置：服务已启动且 PFC_ALLOW_STAGE_BYPASS=1；预算剩余 ≥6 次真实调用。
 */
import { randomUUID } from 'node:crypto';
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
const BASE = 'http://127.0.0.1:5188';
const REPORT_DIR = resolve(
  projectRoot,
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);
const report = {
  at: new Date().toISOString(),
  status: 'PASS',
  scope:
    '跨阶段上下文传递·全链路：req→design→dev→test→release→observe 逐级携带前序产出',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push(assertion(name, !!ok, extra));
  if (!ok) report.errors.push(name);
};

// 各阶段指令（阶段工作法 + 明确基于前序产出）
const STAGES = [
  {
    stage: 'req',
    content:
      '请按需求阶段工作法，把「依赖与安全扫描」能力固化为可作业的需求（功能点、优先级、验收标准、范围与待确认项）。',
  },
  {
    stage: 'design',
    content:
      '请按设计阶段工作法，基于前序需求结论输出「依赖与安全扫描」的方案设计：整体架构、模块划分、关键接口与设计决策。',
  },
  {
    stage: 'dev',
    content:
      '请按开发阶段工作法，基于前序设计结论输出「依赖与安全扫描」的可执行实现计划：任务拆分、实施顺序、每项验证方式与涉及文件。',
  },
  {
    stage: 'test',
    content:
      '请按测试阶段工作法，基于前序实现计划输出「依赖与安全扫描」的测试矩阵：核心用例、场景、预期结果与自动化覆盖标记。',
  },
  {
    stage: 'release',
    content:
      '请按发布阶段工作法，基于前序测试结论输出「依赖与安全扫描」的发布检查清单与回滚方案（含灰度/放量建议）。',
  },
  {
    stage: 'observe',
    content:
      '请按观察复盘阶段工作法，基于前序发布结论输出「依赖与安全扫描」上线后的观察方案：核心指标、监控点、告警与复盘触发条件。',
  },
];

async function waitAiOk(pid, stage, auth) {
  const deadline = Date.now() + 360000;
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

async function main() {
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
      name: '跨阶段上下文全链路验证',
      goal: '验证 req→design→dev→test→release→observe 逐级携带前序产出（上下文闭环）',
      scope: '真实 TEXT 作业 ×6',
    }),
  });
  const req = (await created.json()).req;
  const pid = req.public_id || req.id;
  t('创建验证 req', !!pid, { pid });

  const confirmed = []; // [{stage, text}]
  for (const s of STAGES) {
    const tag = s.stage.toUpperCase();
    // 每次发送前取最新 revision
    let rev;
    try {
      const cur = await (
        await fetch(BASE + '/api/reqs/' + pid, { headers: auth })
      ).json();
      rev = cur.req?.revision;
    } catch {
      /* Non-authoritative diagnostic/readiness output cannot establish success. */
    }
    const body = {
      commandId: randomUUID(),
      expectedRevision: rev,
      content: s.content,
      stage: s.stage,
      mode: 'real',
    };
    // 从 design 起携带前序全部已确认产出
    if (confirmed.length) {
      body.stageContext = confirmed.map((c) => ({
        stage: c.stage,
        title: c.stage + '阶段产出',
        text: c.text,
      }));
    }
    const m = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    if (![200, 201, 202].includes(m.status)) {
      let b = '';
      try {
        b = JSON.stringify(await m.json());
      } catch {
        /* Non-authoritative diagnostic/readiness output cannot establish success. */
      }
      t(
        tag +
          ' 发送 TEXT 作业（' +
          (confirmed.length ? '带 stageContext' : '首阶段') +
          '）',
        false,
        { status: m.status, body: b },
      );
      report.external.push({ step: tag + '-send', status: m.status, body: b });
      continue;
    }
    t(
      tag +
        ' 发送 TEXT 作业（' +
        (confirmed.length ? '带 stageContext' : '首阶段') +
        '）',
      true,
      { status: m.status },
    );
    const ai = await waitAiOk(pid, s.stage, auth);
    t(tag + ' ai 终态 ok', !!(ai && ai.status === 'ok' && !ai.failed), {
      meta: ai?.metadata || (ai && ai.failed ? ai.failed.metadata : null),
    });
    if (!ai || ai.failed || !ai.content || ai.content.trim().length < 30)
      continue;
    const text = ai.content.trim();
    t(tag + ' 产出非空', text.length > 30, { len: text.length });
    const realFlag = await realFlagOf(ai.id);
    t(tag + ' metadata.real=true（DB 直查）', realFlag === 'true', {
      realFlag,
    });

    if (confirmed.length) {
      const noUpstreamClaim =
        !/未提供上一步|未包含上一步|当前(对话|会话)未(提供|包含|包括)上一步|未提供.{0,10}上一步|没有.{0,10}上一步/.test(
          text,
        );
      t(tag + ' 不再声明"未提供上一步内容"', noUpstreamClaim, {
        hasClaim: !noUpstreamClaim,
      });
      const cites =
        /前序|上一步|上文|前述|前文|上述需求|所附|沿用|承接|延续|继承|发布结论|候选范围|发布门禁|(依据|基于|根据|结合|参考|沿用).{0,24}(需求|设计|实现|计划|材料|结论|草案|矩阵|清单|范围|门禁)/.test(
          text,
        );
      t(tag + ' 产出引用/基于前序结论继续', cites, { cites });
    }
    report.external.push({
      step: s.stage,
      ai: { id: ai.id, len: text.length, snippet: text.slice(0, 240) },
    });
    confirmed.push({ stage: s.stage, text });
  }

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

  report.status = summarize(report);
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(
    REPORT_DIR,
    'stage-context-chain-' + Math.floor(Date.now() / 1000) + '.json',
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
      'stage-context-chain-' + Math.floor(Date.now() / 1000) + '.json',
    ),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
