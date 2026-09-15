/* 逐阶段真实 TEXT 验证：8 个阶段 guide+skill 组合的实际产出质量（每阶段 1 次真实 codex 调用）
 * 前置：服务已启动且 PFC_ALLOW_STAGE_BYPASS=1（允许在独立验证 req 上直发任意阶段 TEXT）。
 * 断言：每阶段 ai 终态 ok + metadata.real=true + 产出包含该阶段期望结构关键词。
 * 预算：8 次真实模型调用。
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
  scope: '逐阶段真实 TEXT：8 阶段 guide+skill 组合产出质量（每阶段 1 次模型）',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra) => {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...(extra || {}) });
  if (!ok) report.errors.push(name);
};

const ONLY = process.argv[2]
  ? process.argv[2].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const STAGES = [
  {
    stage: 'idea',
    content:
      '想法：为内部任务管理工具新增「依赖与安全扫描」能力，让版本升级前能自动发现高风险依赖。请按本阶段工作法澄清。',
    expect: /目标|边界|澄清|用户|验收/,
  },
  {
    stage: 'req',
    content:
      '基于上一步澄清：请按需求阶段工作法，把该能力固化为可作业的需求（功能点、优先级、验收标准）。',
    expect: /需求|功能|优先级|验收|范围/,
  },
  {
    stage: 'design',
    content:
      '为「依赖与安全扫描」输出方案设计：整体架构、模块划分、关键接口与设计决策。请按设计阶段工作法产出。',
    expect: /方案|架构|接口|模块|设计|决策/,
  },
  {
    stage: 'dev',
    content:
      '为「依赖与安全扫描」输出可执行的实现计划：任务拆分、实施顺序、每个任务的验证方式。请按开发阶段工作法产出。',
    expect: /计划|任务|步骤|实现|验证/,
  },
  {
    stage: 'test',
    content:
      '为「依赖与安全扫描」输出测试矩阵：核心用例、场景、预期结果与自动化覆盖标记。请按测试阶段工作法产出。',
    expect: /用例|场景|预期|通过|测试/,
  },
  {
    stage: 'accept',
    content:
      '对「依赖与安全扫描」实施结果做验收核对：检查项、所需证据、通过标准。请按验收阶段工作法产出。',
    expect: /验收|通过|证据|检查|标准/,
  },
  {
    stage: 'release',
    content:
      '为「依赖与安全扫描」准备发布：生成发布检查清单与回滚方案（含灰度/放量建议）。请按发布阶段工作法产出。',
    expect: /发布|回滚|灰度|检查|放量/,
  },
  {
    stage: 'observe',
    content:
      '为「依赖与安全扫描」上线后设计观察方案：核心指标、监控点、告警与复盘触发条件。请按观察复盘阶段工作法产出。',
    expect: /指标|监控|观察|告警|复盘/,
  },
];

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
      name: '逐阶段AI能力验证',
      goal: '逐阶段真实 TEXT 验证 guide+skill 组合产出质量（8 阶段）',
      scope: '真实 TEXT 作业',
    }),
  });
  const req = (await created.json()).req;
  const pid = req.public_id || req.id;
  t('创建验证 req', !!pid, { pid });

  for (const s of STAGES.filter((x) => !ONLY || ONLY.includes(x.stage))) {
    const stageTag = s.stage.toUpperCase();
    // 每次发送前取最新 revision（消息发送会使 revision 递增，旧值会 REVISION_CONFLICT）
    let latestRev = req.revision;
    try {
      const cur = await (await fetch(BASE + '/api/reqs/' + pid, { headers: auth })).json();
      latestRev = cur.req?.revision ?? latestRev;
    } catch {}
    const msg = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedRevision: latestRev,
        content: s.content,
        stage: s.stage,
        mode: 'real',
      }),
    });
    if (![200, 201, 202].includes(msg.status)) {
      let body = '';
      try {
        body = JSON.stringify(await msg.json());
      } catch {}
      t(stageTag + ' 发送 TEXT 作业（mode:real）', false, {
        respStatus: msg.status,
        body,
      });
      report.external.push({ stage: s.stage, sendFailed: { status: msg.status, body } });
      continue;
    }
    t(stageTag + ' 发送 TEXT 作业（mode:real）', true, { respStatus: msg.status });

    const deadline = Date.now() + 360000;
    let ai = null;
    while (Date.now() < deadline) {
      const list = await (
        await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=50', { headers: auth })
      ).json();
      const cand = (list.items || []).find((m) => m.role === 'ai' && m.stage === s.stage);
      if (cand && cand.status === 'ok') {
        ai = cand;
        break;
      }
      if (cand && cand.status === 'failed') {
        report.external.push({ step: stageTag + '-final', status: cand.status, meta: cand.metadata });
        break;
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
    t(stageTag + ' ai 终态 ok（codex 真实回写）', !!ai && ai.status === 'ok', {
      meta: ai?.metadata || null,
    });
    if (ai) {
      const c = ai.content || '';
      t(stageTag + ' 回写内容非空', c.trim().length > 30, { len: c.length });
      const hasStructure = s.expect.test(c);
      t(stageTag + ' 产出含本阶段期望结构', hasStructure, { snippet: c.slice(0, 160) });
      let realFlag = null;
      try {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({
          connectionString:
            'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
        });
        const rows = await pool.query(
          "SELECT metadata->>'real' AS realflag FROM \"codex_test_ai_tools_20260914_execbrowser\".messages WHERE public_id=$1",
          [ai.id],
        );
        realFlag = rows.rows[0]?.realflag;
        await pool.end();
      } catch (e) {
        report.external.push({ step: stageTag + '-db-real', error: String(e.message || e) });
      }
      t(stageTag + ' metadata.real=true（DB 直查）', realFlag === 'true', { realFlag });
      report.external.push({
        stage: s.stage,
        ai: { id: ai.id, status: ai.status, snippet: c.slice(0, 260) },
      });
    }
  }

  // 平台仓库零污染（本验证不改源码）
  const dirty = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染（server/apps/packages 无改动）', !polluted, {
    dirty: dirty.split(/\r?\n/).filter(Boolean).slice(0, 6),
  });

  report.status = report.tests.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS';
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(REPORT_DIR, 'stage-text-all-' + Math.floor(Date.now() / 1000) + '.json');
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
    resolve(REPORT_DIR, 'stage-text-all-' + Math.floor(Date.now() / 1000) + '.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
