'use strict';
// 69 号：GitHub/公司 skill 实际安装 → 治理中心登记与绑定增量
// 动作：
//  1) 登记 rdc-req-clarify（需求找平，替代 user-story-canvas 声明）+ rdc-do-unittest（Java 单测）
//  2) design 绑定：移除 user-story-canvas（无真实来源），加入 rdc-req-clarify
//  3) test 绑定：加入 rdc-do-unittest
// 用法：node seed-69-governance-additions.cjs （需 5188 运行 + access-key）
const BASE = process.env.PFC_BASE || 'http://127.0.0.1:5188';
const KEY_FILE =
  process.env.PFC_KEY_FILE ||
  'D:\\项目管理\\product-full-chain-platform\\.local\\pfc-workbench\\access-key.txt';
const fs = require('fs');

async function main() {
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  const H = { origin: BASE, 'content-type': 'application/json' };
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ key }),
  });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + (await login.text()).slice(0, 200));
  const auth = { ...H, cookie: (login.headers.get('set-cookie') || '').split(';')[0] };
  if (!auth.cookie) throw new Error('LOGIN_NO_COOKIE');

  // 现有 caps
  const cur = await fetch(BASE + '/api/caps?limit=100', { headers: auth });
  const curj = await cur.json();
  const caps = curj.items || [];
  const byName = new Map(caps.map((x) => [x.name, x]));

  // 1. 登记（幂等）
  const additions = [
    {
      name: 'rdc-req-clarify',
      type: 'Skill',
      src: '本机已装',
      desc: '需求找平（公司 rdc-req-clarify，陆楠/研发中心）：系统化分析需求文档，支持 PDF/Word/Markdown，输出标准化需求分析文档。已安装至 ~/.codex/skills/rdc-req-clarify。',
    },
    {
      name: 'rdc-do-unittest',
      type: 'Skill',
      src: '本机已装',
      desc: 'Java 后端增量代码单元测试生成与执行（公司 rdc-do-unittest，研发中心）：生成/执行/定位单测失败点。已安装至 ~/.codex/skills/rdc-do-unittest。',
    },
  ];
  const idByName = {};
  for (const a of additions) {
    let cap = byName.get(a.name);
    if (!cap) {
      const r = await fetch(BASE + '/api/caps', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ ...a, endpoint: '', ver: '1.0.0', commandId: '69-add-' + Date.now().toString(36) + '-' + a.name }),
      });
      const rj = await r.json();
      if (r.status !== 201) throw new Error('CAP_CREATE_FAILED ' + a.name + ' ' + JSON.stringify(rj).slice(0, 200));
      cap = rj.cap;
      console.log('created:', a.name, cap.id);
    }
    if (cap.pending) {
      const rv = await fetch(BASE + '/api/caps/' + cap.id + '/review', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ expectedRevision: cap.revision, commandId: '69-review-' + Date.now().toString(36) + '-' + a.name }),
      });
      const rvj = await rv.json();
      if (rv.status !== 200) throw new Error('CAP_REVIEW_FAILED ' + a.name + ' ' + JSON.stringify(rvj).slice(0, 200));
      cap = rvj.cap;
      console.log('reviewed:', a.name);
    }
    if (!cap.enabled) {
      const tg = await fetch(BASE + '/api/caps/' + cap.id + '/toggle', {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ enabled: true, expectedRevision: cap.revision, commandId: '69-enable-' + Date.now().toString(36) + '-' + a.name }),
      });
      const tgj = await tg.json();
      if (tg.status !== 200) throw new Error('CAP_TOGGLE_FAILED ' + a.name + ' ' + JSON.stringify(tgj).slice(0, 200));
      cap = tgj.cap;
      console.log('enabled:', a.name);
    }
    idByName[a.name] = cap.id;
  }

  // 2. 读取当前绑定
  const bj = await fetch(BASE + '/api/bindings', { headers: auth });
  const bjson = await bj.json();
  const items = bjson.items || [];

  // design：移除 user-story-canvas，加入 rdc-req-clarify
  const design = items.find((x) => x.stage === 'design');
  if (!design) throw new Error('NO_DESIGN_BINDING');
  const designIds = (design.capIds || []).filter((id) => {
    const c = caps.find((x) => x.id === id);
    return c && c.name !== 'user-story-canvas';
  });
  const hadCanvas = designIds.length !== (design.capIds || []).length;
  if (!designIds.includes(idByName['rdc-req-clarify'])) designIds.push(idByName['rdc-req-clarify']);

  // test：加入 rdc-do-unittest
  const test = items.find((x) => x.stage === 'test');
  if (!test) throw new Error('NO_TEST_BINDING');
  const testIds = [...(test.capIds || [])];
  if (!testIds.includes(idByName['rdc-do-unittest'])) testIds.push(idByName['rdc-do-unittest']);

  // PUT
  const put = async (stage, capIds, rev) => {
    const r = await fetch(BASE + '/api/bindings', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ stage, capIds, expectedRevision: rev, commandId: '69-bind-' + Date.now().toString(36) + '-' + stage }),
    });
    const rj = await r.json();
    if (r.status !== 200) throw new Error('BINDING_FAILED ' + stage + ' ' + JSON.stringify(rj).slice(0, 200));
    console.log('binding', stage, '->', capIds.length, 'caps (rev', rj.revision + ')');
    return rj;
  };
  await put('design', designIds, design.revision);
  await put('test', testIds, test.revision);
  console.log('design removed user-story-canvas:', hadCanvas);

  // 3. 复核
  const list = await fetch(BASE + '/api/caps?limit=100', { headers: auth });
  const listj = await list.json();
  const on = (listj.items || []).filter((x) => x.enabled && !x.pending);
  const bj2 = await fetch(BASE + '/api/bindings', { headers: auth });
  const bj2j = await bj2.json();
  for (const it of bj2j.items || []) console.log('verify binding', it.stage, (it.capIds || []).length);
  console.log('RESULT caps total:', listj.total || (listj.items || []).length, 'enabled:', on.length);
  console.log('VERDICT PASS');
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
