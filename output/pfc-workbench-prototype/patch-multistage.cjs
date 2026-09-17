'use strict';
const fs = require('fs');
const base = 'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/original/';

// ---------- workbench.js：exec-bar 显示条件 ----------
let w = fs.readFileSync(base + 'workbench.js', 'utf8');
const wOld =
  "P.domainView?.pg() && stage === 'dev' ? (P.execBar ? P.execBar(r, stage) : '<div class=\"exec-bar\" role=\"status\"><span class=\"exec-cap\">开发执行暂不可用</span></div>') : ''";
const wNew =
  "P.domainView?.pg() && ['design', 'dev', 'test'].includes(stage) ? (P.execBar ? P.execBar(r, stage) : '<div class=\"exec-bar\" role=\"status\"><span class=\"exec-cap\">执行基线暂不可用</span></div>') : ''";
if (!w.includes(wOld)) {
  console.error('workbench exec-bar anchor NOT FOUND');
  process.exit(1);
}
w = w.replace(wOld, wNew);
fs.writeFileSync(base + 'workbench.js', w, 'utf8');
console.log('workbench.js: exec-bar design/dev/test');

// ---------- domain-conversation.js：阶段感知 ----------
let d = fs.readFileSync(base + 'domain-conversation.js', 'utf8');

// 1) refetchStagePlan：dev → 当前阶段（design/dev/test）
const r1Old = `        if (!r || r.id !== id || r.stage !== 'dev') return;
        const data = await stageApi(id, 'GET', '/stage-plan?stage=dev');
        if (P.r()?.id !== id) return;
        const k = stageKey(r, 'dev');`;
const r1New = `        if (!r || r.id !== id || !['design', 'dev', 'test'].includes(r.stage)) return;
        const data = await stageApi(id, 'GET', '/stage-plan?stage=' + r.stage);
        if (P.r()?.id !== id) return;
        const k = stageKey(r, r.stage);`;
if (!d.includes(r1Old)) {
  console.error('refetch anchor NOT FOUND');
  process.exit(1);
}
d = d.replace(r1Old, r1New);
console.log('refetch stage-aware');

// 2) execBar 表单模板：placeholder 按阶段预置
const r2Old = `        '<label class="exec-field">工作区<input aria-label="阶段工作区" data-sp="workspace" value="' + f(draft.workspace) + '" placeholder="授权 workspace 绝对路径" /></label>' +
        '<label class="exec-field">允许文件<input aria-label="允许文件" data-sp="allowedFiles" value="' + f(draft.allowedFiles) + '" placeholder="glob 逗号分隔，如 src/**, package.json" /></label>' +
        '<label class="exec-field">允许命令<input aria-label="允许命令" data-sp="allowedCommands" value="' + f(draft.allowedCommands) + '" placeholder="命令逗号分隔，如 node --version, npm test" /></label>' +`;
const r2New = `        '<label class="exec-field">工作区<input aria-label="阶段工作区" data-sp="workspace" value="' + f(draft.workspace) + '" placeholder="授权 workspace 绝对路径（' + (stage === 'design' ? '设计产物目录' : stage === 'test' ? '测试工程目录' : '代码工程目录') + '）" /></label>' +
        '<label class="exec-field">允许文件<input aria-label="允许文件" data-sp="allowedFiles" value="' + f(draft.allowedFiles) + '" placeholder="' + (stage === 'design' ? 'docs/**, *.md' : stage === 'test' ? 'test/**, src/**, package.json' : 'src/**, package.json') + '" /></label>' +
        '<label class="exec-field">允许命令<input aria-label="允许命令" data-sp="allowedCommands" value="' + f(draft.allowedCommands) + '" placeholder="命令逗号分隔，如 ' + (stage === 'design' ? 'ls, cat package.json' : stage === 'test' ? 'npm test, node --test' : 'node --version, npm test') + '" /></label>' +`;
if (!d.includes(r2Old)) {
  console.error('form template anchor NOT FOUND');
  process.exit(1);
}
d = d.replace(r2Old, r2New);
console.log('execBar form stage templates');

// 3) remote actions：'dev' → d.stage || r.stage
const actions = ['stage-freeze', 'stage-review', 'stage-revoke', 'stage-refreeze'];
for (const a of actions) {
  const anchor = `remote['${a}'] = async (d) => {`;
  const at = d.indexOf(anchor);
  if (at < 0) {
    console.error('action anchor NOT FOUND:', a);
    process.exit(1);
  }
  // 在函数体开头插入 stage 变量
  const insertAt = d.indexOf('const r = P.r();', at) + 'const r = P.r();'.length;
  d =
    d.slice(0, insertAt) +
    `\n      const stage = d.stage || r.stage;` +
    d.slice(insertAt);
  // 替换本函数体内 stageKey(r, 'dev') 与 stage: 'dev'
  const bodyStart = at;
  const bodyEnd = d.indexOf('\n    };', bodyStart) + '\n    };'.length;
  let body = d.slice(bodyStart, bodyEnd);
  body = body.replaceAll("stageKey(r, 'dev')", 'stageKey(r, stage)');
  body = body.replaceAll("stage: 'dev'", 'stage');
  d = d.slice(0, bodyStart) + body + d.slice(bodyEnd);
  console.log('action stage-aware:', a);
}

// 4) execBar 渲染里 btn 传 stage（让 remote 知道按钮所在阶段）
const r4Old = `      const btn = (action, label, data, cls) =>
        P.btn(action, label, { req: r.id, ...(data || {}) }, cls || '');`;
const r4New = `      const btn = (action, label, data, cls) =>
        P.btn(action, label, { req: r.id, stage, ...(data || {}) }, cls || '');`;
if (!d.includes(r4Old)) {
  console.error('btn anchor NOT FOUND');
  process.exit(1);
}
d = d.replace(r4Old, r4New);
console.log('execBar btn carries stage');

fs.writeFileSync(base + 'domain-conversation.js', d, 'utf8');
console.log('done');
