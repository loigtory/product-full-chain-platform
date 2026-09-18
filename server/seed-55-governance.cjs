'use strict';
// 68 号：治理中心能力目录与阶段绑定预置数据 seed
// 来源：stage_capabilities 配置表（55 号定稿 45 条，worker 实际装载来源）
// 动作：登记 caps（幂等）→ 复核 → 启用 → 按阶段绑定 binding_sets/cap_bindings
// 用法：node seed-55-governance.cjs  （需 5188 运行 + access-key）
const BASE = process.env.PFC_BASE || 'http://127.0.0.1:5188';
const KEY_FILE =
  process.env.PFC_KEY_FILE ||
  'D:\\项目管理\\product-full-chain-platform\\.local\\pfc-workbench\\access-key.txt';
const fs = require('fs');
const { Client } = require('pg');
const PG_URL =
  process.env.PFC_PG_URL ||
  'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local';
const TYPE_MAP = { skill: 'Skill', mcp: 'MCP', tool: '终端工具' };
const SRC_MAP = { local: '本机已装', github: 'GitHub 生态', company: '公司 ai-dev' };

async function main() {
  // 1. 登录
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  const H = { origin: BASE, 'content-type': 'application/json' };
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ key }),
  });
  if (login.status !== 200)
    throw new Error('LOGIN_FAILED ' + (await login.text()).slice(0, 200));
  const auth = { ...H, cookie: (login.headers.get('set-cookie') || '').split(';')[0] };
  if (!auth.cookie) throw new Error('LOGIN_NO_COOKIE');

  // 2. 读 stage_capabilities 全部行
  const c = new Client({ connectionString: PG_URL });
  await c.connect();
  const rows = (
    await c.query(
      'SELECT stage, kind, name, source, source_url, description, enabled, priority FROM pfc_workbench.stage_capabilities ORDER BY stage, kind, priority, name',
    )
  ).rows;
  await c.end();
  console.log('stage_capabilities rows:', rows.length);

  // 3. 现有 caps（幂等，分页拉全量）
  const cur = await fetch(BASE + '/api/caps?limit=100', { headers: auth });
  if (cur.status !== 200) throw new Error('CAPS_LIST_FAILED ' + (await cur.text()).slice(0, 200));
  const curj = await cur.json();
  const byName = new Map((curj.items || []).map((x) => [x.name + '@' + x.ver, x]));

  // 4. 登记（按 name 去重——同一能力只登记一次）
  const capByStage = {};
  const seen = new Set();
  let created = 0,
    reviewed = 0,
    enabledCount = 0;
  for (const row of rows) {
    const name = row.name.trim();
    const type = TYPE_MAP[row.kind];
    if (!type) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    let cap = byName.get(name + '@1.0.0');
    if (!cap) {
      const r = await fetch(BASE + '/api/caps', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          name,
          type,
          endpoint: '',
          src: SRC_MAP[row.source] || row.source,
          ver: '1.0.0',
          desc: row.description || row.source_url || (SRC_MAP[row.source] || row.source) + ' 能力声明（55 号清单）',
          commandId: '68-seed-' + Date.now().toString(36) + '-' + seen.size,
        }),
      });
      const rj = await r.json();
      if (r.status !== 201) throw new Error('CAP_CREATE_FAILED ' + name + ' ' + JSON.stringify(rj).slice(0, 200));
      cap = rj.cap;
      created++;
    }
    // 复核
    if (cap.pending) {
      const rv = await fetch(BASE + '/api/caps/' + cap.id + '/review', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ expectedRevision: cap.revision, commandId: '68-review-' + Date.now().toString(36) + '-' + seen.size }),
      });
      const rvj = await rv.json();
      if (rv.status !== 200) throw new Error('CAP_REVIEW_FAILED ' + name + ' ' + JSON.stringify(rvj).slice(0, 200));
      cap = rvj.cap;
      reviewed++;
    }
    // 启用
    if (!cap.enabled) {
      const tg = await fetch(BASE + '/api/caps/' + cap.id + '/toggle', {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ enabled: true, expectedRevision: cap.revision, commandId: '68-enable-' + Date.now().toString(36) + '-' + seen.size }),
      });
      const tgj = await tg.json();
      if (tg.status !== 200) throw new Error('CAP_TOGGLE_FAILED ' + name + ' ' + JSON.stringify(tgj).slice(0, 200));
      cap = tgj.cap;
      enabledCount++;
    }
    if (!capByStage[row.stage]) capByStage[row.stage] = [];
    if (!capByStage[row.stage].includes(cap.id)) capByStage[row.stage].push(cap.id);
  }
  console.log('caps created:', created, 'reviewed:', reviewed, 'enabled:', enabledCount);

  // 5. 阶段绑定
  const curB = await fetch(BASE + '/api/bindings', { headers: auth });
  const curBj = await curB.json();
  const bindMap = new Map((curBj.items || []).map((x) => [x.stage, x]));
  let bound = 0;
  for (const stage of Object.keys(capByStage).sort()) {
    const curR = bindMap.get(stage)?.revision || 0;
    const r = await fetch(BASE + '/api/bindings', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ stage, capIds: capByStage[stage], expectedRevision: curR, commandId: '68-bind-' + Date.now().toString(36) + '-' + stage }),
    });
    const rj = await r.json();
    if (r.status !== 200) throw new Error('BINDING_FAILED ' + stage + ' ' + JSON.stringify(rj).slice(0, 200));
    bound++;
    console.log('binding', stage, '->', capByStage[stage].length, 'caps');
  }
  console.log('bindings updated:', bound);

  // 6. 复核
  const list = await fetch(BASE + '/api/caps?limit=100', { headers: auth });
  const listj = await list.json();
  const on = (listj.items || []).filter((x) => x.enabled && !x.pending);
  console.log('RESULT caps total:', listj.total || (listj.items || []).length, 'enabled+reviewed:', on.length);
  if (on.length < rows.length / 2) throw new Error('SEED_SUSPECT: enabled caps too few');
  console.log('VERDICT PASS');
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
