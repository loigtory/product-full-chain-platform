import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(root, '../..');
const baseline = 'a9eec73ed65610f09a80f11331edbda1b4252a67';
const accepted = 'c3f6c1869d1dad06c9b316ff61cbce359eba8358';
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
const source = (name) => readFileSync(resolve(root, 'original', name), 'utf8');
const normalize = (text) => text.replace(/\r\n/g, '\n');
const results = [],
  fingerprints = {};
const check = (name, fn) => {
  fn();
  results.push({ name, status: 'PASS' });
};
check('exact-approved-scope-and-protected-domain-fingerprints', () => {
  const paths = [
    'index.html',
    'original/app.js',
    'original/workbench.js',
    'original/workbench-shell.js',
    'original/flow-model.js',
    'original/flow-view.js',
    'original/flow-actions.js',
    'original/flow-demo-data.js',
    'original/flow.css',
    'verify-static.mjs',
    'flow-browser-fixture.mjs',
    'verify-flow-model.mjs',
    'verify-flow-browser.mjs',
    'verify-flow-architecture.mjs',
  ].map((p) => 'output/pfc-workbench-prototype/' + p);
  const docs = [
    '19-开发路线图-20260912.md',
    '20-Codex交接提示词-20260912.md',
    '29-M2c-3治理与项目方案及范围确认-20260912.md',
    '30-连续协作原型实施与验收-20260912.md',
    'README.md',
  ].map((p) => 'docs/planning/prototype-v3/' + p);
  const allowed = new Set([
    ...paths,
    ...docs,
    'AGENTS.md',
    'output/pfc-workbench-prototype/README.md',
    'docs/quality-gate/reports/flow-prototype-20260912.md',
  ]);
  const changed = [
    ...git('diff', '--name-only', '-z', baseline, accepted).split('\0'),
  ].filter(Boolean);
  assert.deepEqual(
    changed.filter(
      (p) =>
        !allowed.has(p) &&
        !/^docs\/quality-gate\/reports\/flow-prototype-20260912\/[^/]+\.(json|png)$/.test(
          p,
        ),
    ),
    [],
  );
  for (const file of [
    'original/domain-client.js',
    'original/domain-view.js',
    'original/domain-actions.js',
    'original/api-client.js',
    'original/data-layer.js',
    'original/model.js',
    'original/base.css',
    'original/guide.css',
  ]) {
    const path = 'output/pfc-workbench-prototype/' + file,
      actual = normalize(git('show', accepted + ':' + path));
    assert.equal(
      actual,
      normalize(git('show', baseline + ':' + path)),
      path + ' changed',
    );
    fingerprints[path] = createHash('sha256').update(actual).digest('hex');
  }
});
check('current-governance-scope-and-preserved-reference', () => {
  const design = readFileSync(
    resolve(
      repo,
      'docs/planning/prototype-v3/31-R1后续治理衔接方案与范围确认-20260913.md',
    ),
    'utf8',
  );
  const section = design.slice(
    design.indexOf('## 四、候选实施白名单'),
    design.indexOf('## 五、隔离数据'),
  );
  const files = [
    ...section.matchAll(/\| \x60((?:server|output)\/[^\x60]+)\x60 \|/g),
  ].map((m) => m[1]);
  assert.equal(files.length, 63);
  const allowed = new Set([
    ...files,
    'AGENTS.md',
    'output/pfc-workbench-prototype/README.md',
    ...[
      '19-开发路线图-20260912.md',
      '20-Codex交接提示词-20260912.md',
      '31-R1后续治理衔接方案与范围确认-20260913.md',
      '32-M2c-3实施与验收-20260913.md',
      'README.md',
    ].map((p) => 'docs/planning/prototype-v3/' + p),
    'docs/quality-gate/reports/m2c-3-governance-20260913.md',
  ]);
  const changed = [
    ...git(
      'diff',
      '--name-only',
      '-z',
      accepted,
      '04fd81a28e16abe2d92ff87799a78750fbd497b4',
    ).split('\0'),
  ].filter(Boolean);
  assert.deepEqual(
    changed.filter(
      (p) =>
        !allowed.has(p) &&
        !/^docs\/quality-gate\/reports\/m2c-3-governance-20260913\/(?:(?:governance|domain|flow|legacy)\/)?[^/]+\.(?:json|png|md)$/.test(
          p,
        ),
    ),
    [],
  );
  for (const name of [
    'flow-demo-data.js',
    'flow-model.js',
    'flow-view.js',
    'flow-actions.js',
    'flow.css',
    'workbench-shell.js',
    'data-layer.js',
    'model.js',
    'base.css',
    'guide.css',
  ]) {
    const path = 'output/pfc-workbench-prototype/original/' + name,
      actual = normalize(git('show', '04fd81a28e16abe2d92ff87799a78750fbd497b4:' + path));
    assert.equal(
      actual,
      normalize(git('show', accepted + ':' + path)),
      name + ' is protected',
    );
    fingerprints[path] = createHash('sha256').update(actual).digest('hex');
  }
});
const ctx = vm.createContext({
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  Date,
  console,
  setTimeout,
  clearTimeout,
  URL,
  structuredClone,
  AbortSignal,
});
for (const f of ['data.js', 'model.js', 'ui.js'])
  vm.runInContext(source(f), ctx);
const P = ctx.window.PFC;
P.now = () => 1799836800000;
check('shared-frame-preserves-original-eight-stage-three-panel-html', () => {
  vm.runInContext(
    git(
      'show',
      baseline + ':output/pfc-workbench-prototype/original/workbench.js',
    ),
    ctx,
  );
  const before = {};
  for (const stage of [
    'idea',
    'req',
    'design',
    'dev',
    'test',
    'accept',
    'release',
    'observe',
  ]) {
    const r = P.makeRequirement(
      'CODEx_TEST_FLOW_ARCH_' + stage,
      '合成结构验证',
      '固定材料',
      stage,
    );
    P.s.reqs[r.id] = r;
    for (const panel of ['terminal', 'canvas', 'evidence']) {
      Object.assign(P.s.ui, {
        route: 'work',
        req: r.id,
        stage,
        panel,
        artifactStage: stage,
      });
      before[stage + ':' + panel] = P.renderWork();
    }
  }
  vm.runInContext(source('workbench-shell.js'), ctx);
  vm.runInContext(source('workbench.js'), ctx);
  for (const [key, html] of Object.entries(before)) {
    const [stage, panel] = key.split(':');
    Object.assign(P.s.ui, {
      route: 'work',
      req: 'CODEx_TEST_FLOW_ARCH_' + stage,
      stage,
      panel,
      artifactStage: stage,
    });
    assert.equal(
      P.renderWork().replace(' aria-label="工作面板"', ''),
      html,
      key,
    );
  }
});
check('shell-has-no-business-state-and-flow-has-no-runtime-adapter', () => {
  for (const file of [
    'flow-demo-data.js',
    'flow-model.js',
    'flow-view.js',
    'flow-actions.js',
    'workbench-shell.js',
  ]) {
    const code = source(file);
    assert.doesNotMatch(
      code,
      /\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|\b(?:PFCAPI|PFCWS)\b|\bP\s*\.\s*(?:s|save|domain|domainView)\b/,
      file,
    );
  }
  assert.doesNotMatch(
    source('workbench-shell.js'),
    /localStorage|sessionStorage|createStore|reduce\s*\(/,
  );
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  for (const [first, second] of [
    ['ui.js', 'workbench-shell.js'],
    ['flow-demo-data.js', 'flow-model.js'],
    ['flow-model.js', 'flow-view.js'],
    ['flow-actions.js', 'app.js'],
  ])
    assert.ok(
      html.indexOf('original/' + first) < html.indexOf('original/' + second),
    );
});
check(
  'downstream-change-has-review-action-without-losing-running-control',
  () => {
    for (const f of ['flow-demo-data.js', 'flow-model.js', 'flow-view.js'])
      vm.runInContext(source(f), ctx);
    const D = ctx.window.PFCFlowData,
      M = ctx.window.PFCFlow,
      V = ctx.window.PFCFlowView;
    let s = D.create('CODEx_TEST_FLOW_20260912_arch'),
      n = 0;
    const act = (type, payload = {}) => {
      s = M.reduce(s, {
        id: 'arch-' + ++n,
        type,
        reqId: s.selected,
        expectedRevision: s.revision,
        payload,
      });
    };
    for (const type of [
      'generate',
      'confirm-business',
      'confirm-design',
      'start-run',
    ])
      act(type);
    act('propose', { days: 3 });
    assert.equal(V.next(M.current(s))[0], 'step-run');
    act('step-run');
    act('step-run');
    assert.equal(V.next(M.current(s))[0], 'apply-proposal');
    act('apply-proposal');
    assert.equal(M.current(s).stage, 'req');
    assert.ok(M.current(s).history[0].run);
  },
);
const report = {
  status: 'PASS',
  checks: results.length,
  results,
  baseline,
  fingerprints,
  hashNormalization:
    'UTF-8 text CRLF to LF; unchanged tracked scope independently checked with git diff',
  data: 'synthetic VM objects only',
  cleanup: 'process-local objects discarded',
};
assert.equal(
  process.env.PFC_FLOW_EVIDENCE_DIR,
  'docs/quality-gate/reports/local-use-baseline-20260913/flow',
  'EXPLICIT_EVIDENCE_TARGET_REQUIRED',
);
const evidence = resolve(repo, process.env.PFC_FLOW_EVIDENCE_DIR);
mkdirSync(evidence, { recursive: true });
writeFileSync(
  resolve(evidence, 'architecture-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
