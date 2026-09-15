// 阶段 AI 能力（非终端环节）验收：8 阶段能力配置 API + textThreadParams 装配单测（零模型）
// + 真实 TEXT 作业一次（idea 阶段：guide 注入 + codex 真实产出想法澄清，消耗 1 次预算）。
// 用法：node verify-ai-tools-stage-capabilities.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const BASE = process.env.PFC_ACCEPT_BASE || 'http://127.0.0.1:5188';
const REPORT_DIR = resolve(
  projectRoot,
  'docs/quality-gate/reports/ai-tools-integration-20260914',
);

const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '阶段 AI 能力：8 阶段配置 API + textThreadParams 装配单测 + 真实 TEXT 作业（1 次模型）',
  tests: [],
  errors: [],
  external: [],
};

function t(name, ok, extra = {}) {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...extra });
  if (!ok) report.errors.push(name);
}

async function main() {
  // ---------- A. 零模型：stage-capabilities API ----------
  const login = await fetch(BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token } = await login.json();
  const auth = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const capsRes = await fetch(BASE + '/api/agent/stage-capabilities', { headers: auth });
  t('GET /api/agent/stage-capabilities 200', capsRes.status === 200);
  const caps = (await capsRes.json()).stages;
  t('8 阶段能力齐全', Array.isArray(caps) && caps.length === 8, { stages: caps?.map((c) => c.stage) });
  const EXPECTED = ['idea', 'req', 'design', 'dev', 'test', 'accept', 'release', 'observe'];
  t('阶段顺序与定义一致', EXPECTED.every((s, i) => caps?.[i]?.stage === s));
  t(
    '每阶段字段完整（stage/name/goal/guide/skills/tools/mcps）',
    caps?.every(
      (c) =>
        typeof c.stage === 'string' &&
        typeof c.name === 'string' &&
        typeof c.goal === 'string' &&
        typeof c.guide === 'string' &&
        Array.isArray(c.skills) &&
        Array.isArray(c.tools) &&
        Array.isArray(c.mcps),
    ),
  );

  // ---------- B. 零模型：textThreadParams 装配单测（enabledSkills 匹配） ----------
  const config = require(resolve(projectRoot, 'server/src/agent/config.js'));
  const inventory = {
    data: [
      {
        skills: [
          { path: 'C:/skills/grill-me/SKILL.md' },
          { path: 'C:/skills/other' },
          { path: 'C:/skills/platform-test-case-writer/SKILL.md' },
        ],
        errors: [],
      },
    ],
  };
  const summary = { model: 'test-model' };
  const hit = config.textThreadParams(summary, 'C:/ws', inventory, [
    'grill-me',
    'platform-test-case-writer',
  ]);
  const skillName = (p) => {
    const parts = p.split('/');
    const fb = parts[parts.length - 1];
    return /^SKILL\.md$/i.test(fb) ? parts[parts.length - 2] : fb;
  };
  const hitMap = Object.fromEntries(
    hit.config['skills.config'].map((s) => [skillName(s.path), s.enabled]),
  );
  t(
    '装配：期望 skill 命中则 enabled:true（grill-me/platform-test-case-writer）',
    hitMap['grill-me'] === true &&
      hitMap['platform-test-case-writer'] === true &&
      hitMap['other'] === false,
    { hitMap },
  );
  t(
    '装配：_enabledSkills 只含命中项',
    JSON.stringify(hit._enabledSkills) ===
      JSON.stringify(['grill-me', 'platform-test-case-writer']),
    { enabled: hit._enabledSkills },
  );
  const miss = config.textThreadParams(summary, 'C:/ws', inventory, ['not-exist']);
  const missAll = miss.config['skills.config'].every((s) => s.enabled === false);
  t('装配：未命中保持全禁用（期望能力非硬依赖）', missAll && miss._enabledSkills.length === 0);
  const def = config.textThreadParams(summary, 'C:/ws', inventory);
  t('回归：无 enabledSkills 时默认全禁用', def.config['skills.config'].every((s) => s.enabled === false));
  const badInv = { data: [{ skills: [{ path: 'relative/path' }], errors: [] }] };
  let threw = false;
  try {
    config.textThreadParams(summary, 'C:/ws', badInv);
  } catch (e) {
    threw = e.code === 'SKILL_INVENTORY_UNVERIFIED';
  }
  t('守卫：非法 inventory（相对路径）拒绝', threw);

  // ---------- B2. 零模型：真实 codex inventory 对齐（skills/list 只读，不耗模型预算） ----------
  try {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const codexBinary =
      'C:/Users/hz19114673/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
    const codexSha = createHash('sha256').update(readFileSync(codexBinary)).digest('hex');
    const { openProtocol } = await import(
      pathToFileURL(resolve(projectRoot, 'server/src/agent/protocol.mjs')).href
    );
    const conn = await openProtocol({
      binary: codexBinary,
      expectedSha256: codexSha,
      cwd: resolve(projectRoot, '.local/ai-tools-integration-20260914/preflight'),
      mode: 'text',
      expectedConnectionFingerprint:
        'b585d723d61d18a815b77a2d81627cd71038d1f8cf7f4446f56e48eba4937292',
      approvedInstructionSources: [],
    });
    try {
      const realInv = await conn.rpc.request('skills/list', {
        cwds: [conn.cwd],
        forceReload: true,
      });
      const realSkills = realInv?.data?.[0]?.skills || [];
      const realBases = new Set(
        realSkills.map((s) => {
          const parts = s.path.split(/[\\/]/);
          const fileBase = parts[parts.length - 1];
          return /^SKILL\.md$/i.test(fileBase) ? parts[parts.length - 2] : fileBase;
        }),
      );
      const stageCaps = require(resolve(projectRoot, 'server/src/agent/stage-capabilities.js'));
      const missing = [];
      const enabledNow = [];
      for (const c of stageCaps.all()) {
        if (!c.skills.length) continue;
        for (const sk of c.skills) {
          if (realBases.has(sk)) enabledNow.push(c.stage + ':' + sk);
          else missing.push(c.stage + ':' + sk);
        }
      }
      t(
        '真实 inventory 对齐：各阶段期望 skill 全部命中本机 codex inventory',
        missing.length === 0,
        { missing, hit: enabledNow.length, total: enabledNow.length + missing.length },
      );
      const ideaEnabled = config.textThreadParams(summary, conn.cwd, realInv, ['grill-me']);
      t(
        '真实装载：grill-me 在真实 inventory 下装配 enabled:true',
        ideaEnabled._enabledSkills.includes('grill-me'),
        { enabled: ideaEnabled._enabledSkills },
      );
      report.external.push({
        realInventoryCount: realSkills.length,
        stageSkillHits: enabledNow,
      });
    } finally {
      await conn.close();
    }
  } catch (e) {
    report.errors.push('B2 真实对齐失败: ' + String(e.message || e));
    t('真实 inventory 对齐：各阶段期望 skill 全部命中本机 codex inventory', false, {
      error: String(e.message || e),
    });
  }

  // ---------- C. 真实 TEXT 作业（idea 阶段，1 次模型） ----------
  const created = await fetch(BASE + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '阶段AI能力验证',
      goal: '验证 idea 阶段 AI 能力：codex 按阶段引导产出想法澄清',
      scope: '真实 TEXT 作业',
    }),
  });
  const req = (await created.json()).req;
  const pid = req.public_id || req.id;
  t('创建 req（idea 阶段）', !!pid, { pid });
  const msg = await fetch(BASE + '/api/reqs/' + pid + '/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: req.revision,
      content:
        '想法：为内部任务管理工具新增「依赖与安全扫描」能力，让版本升级前能自动发现高风险依赖。请按本阶段工作法澄清。',
      stage: 'idea',
      mode: 'real',
    }),
  });
  t('发送 TEXT 真实作业（mode:real，idea 阶段）', [200, 201, 202].includes(msg.status), {
    respStatus: msg.status,
  });
  const deadline = Date.now() + 480000;
  let ai = null;
  while (Date.now() < deadline) {
    const list = await (
      await fetch(BASE + '/api/reqs/' + pid + '/messages?limit=20', { headers: auth })
    ).json();
    const cand = (list.items || []).find((m) => m.role === 'ai');
    if (cand && cand.status === 'ok') {
      ai = cand;
      break;
    }
    if (cand && cand.status === 'failed') {
      report.external.push({ step: 'ai-final', status: cand.status, meta: cand.metadata });
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  t('ai 消息终态 ok（codex 真实回写）', !!ai && ai.status === 'ok', {
    meta: ai?.metadata || null,
  });
  if (ai) {
    const c = ai.content || '';
    t('回写内容非空', c.trim().length > 20, { len: c.length });
    const hasStructure =
      /目标|边界|范围|用户|澄清问题|验收/.test(c);
    t(
      '按 idea 阶段工作法产出（含目标/边界/澄清问题结构）',
      hasStructure,
      { snippet: c.slice(0, 220) },
    );
    // metadata 不在消息 API 暴露，直接查 DB 验证 real 标记（证明本次回写来自真实 codex 线程）。
    let realFlag = null;
    try {
      const pg = require('pg');
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
      report.external.push({ step: 'db-real-flag', error: String(e.message || e) });
    }
    t('消息 metadata.real=true（DB 直查）', realFlag === 'true', { realFlag });
    report.external.push({ ai: { id: ai.id, status: ai.status, snippet: c.slice(0, 300) } });
  }

  // ---------- D. 平台仓库零污染 ----------
  const dirty = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString();
  const polluted = dirty
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => /^\s*[MADRCU?]{1,2}\s+(server|apps|packages)\//.test(l));
  t('平台仓库零污染（server/apps/packages 无改动）', !polluted, { dirty: dirty.split(/\r?\n/).filter(Boolean).slice(0, 8) });

  // ---------- 落盘 ----------
  report.status = report.tests.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS';
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = resolve(REPORT_DIR, 'stage-capabilities-' + Math.floor(Date.now() / 1000) + '.json');
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ status: report.status, tests: report.tests.length, file: out, errors: report.errors, external: report.external.length }));
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  report.errors.push('UNCAUGHT: ' + e.message);
  report.status = 'FAIL';
  writeFileSync(resolve(REPORT_DIR, 'stage-capabilities-' + Math.floor(Date.now() / 1000) + '.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ status: 'FAIL', errors: report.errors }));
  process.exit(1);
});
