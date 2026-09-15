'use strict';
// 阶段 AI 能力面板浏览器核验（零模型）：打开 workbench（连 5188），进入 idea 阶段，
// 断言"本阶段启用能力"面板渲染 goal + skills chips + tools，截图留证。
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const outputDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(outputDir, '..', '..');
const base = 'http://127.0.0.1:5188';
const evidenceDir = resolve(projectRoot, '.local/ai-tools-live-browser-20260915');
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: '阶段 AI 能力面板浏览器核验（零模型）：stageCaps 拉取 + idea 阶段"本阶段启用能力"渲染',
  tests: [],
  errors: [],
  external: [],
};
const t = (name, ok, extra = {}) => {
  report.tests.push({ name, status: ok ? 'PASS' : 'FAIL', ...extra });
  if (!ok) report.errors.push(name);
};
try {
  mkdirSync(evidenceDir, { recursive: true });
  const login = await fetch(base + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'owner' }),
  });
  const { token, user } = await login.json();
  const auth = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  // 新建一个真实 req 进入 idea 阶段
  const created = await fetch(base + '/api/reqs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      commandId: randomUUID(),
      name: '阶段能力面板核验（浏览器）',
      goal: '核验 idea 阶段"本阶段启用能力"面板渲染',
      scope: 'stage-capabilities 面板',
    }),
  });
  const resp = await created.json();
  const reqId = resp.req.public_id || resp.req.id;
  t('创建 req 201', created.status === 201, { status: created.status });

  const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(
    ({ base, name }) => {
      window.PFC_DATA_MODE = 'api';
      window.PFC_API_BASE = base;
      window.PFC_USER_NAME = name;
    },
    { base, name: user.name },
  );
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(pathToFileURL(resolve(outputDir, 'index.html')).href);
  await page.waitForFunction(() => window.PFC?.s?.stageCaps && window.PFC.s.stageCaps['idea'], null, {
    timeout: 20000,
  });
  const capKeys = await page.evaluate(() => Object.keys(window.PFC.s.stageCaps).length);
  t('stageCaps 拉取（8 阶段索引）', capKeys === 8, { capKeys });

  await page.evaluate(({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'idea' }), {
    id: reqId,
  });
  await page.waitForFunction(() => document.querySelector('.rail-section .rail-title'), null, {
    timeout: 15000,
  });
  const section = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.rail-title')].map((x) => x.textContent.trim());
    const capSection = [...document.querySelectorAll('.rail-section')].find((s) =>
      (s.querySelector('.rail-title')?.textContent || '').includes('本阶段启用能力'),
    );
    if (!capSection) return null;
    return {
      titles,
      goal: capSection.querySelector('.muted')?.textContent?.trim()?.slice(0, 60) || '',
      chips: capSection.querySelectorAll('.skill-chip').length,
      tools: capSection.textContent.includes('工具：'),
    };
  });
  t('"本阶段启用能力"面板渲染', !!section, { section });
  if (section) {
    t('goal 文本渲染', section.goal.length > 10, { goal: section.goal });
    t('skills chips 渲染（期望能力）', section.chips > 0, { chips: section.chips });
    t('tools 行渲染', section.tools);
    report.external.push({ section });
  }
  await page.screenshot({ path: resolve(evidenceDir, 'panel-stage-caps-1440.png'), fullPage: false });
  t('截图已保存', true);

  // release 阶段核验（新增真实 skill：release-checklist/release-ops）
  await page.evaluate(({ id }) => window.PFC.go({ route: 'work', req: id, stage: 'release' }), {
    id: reqId,
  });
  await page.waitForFunction(() => document.querySelector('.rail-section .rail-title'), null, {
    timeout: 15000,
  });
  const releaseSection = await page.evaluate(() => {
    const capSection = [...document.querySelectorAll('.rail-section')].find((s) =>
      (s.querySelector('.rail-title')?.textContent || '').includes('本阶段启用能力'),
    );
    if (!capSection) return null;
    return {
      chips: [...capSection.querySelectorAll('.skill-chip')].map((x) => x.textContent.trim()),
      emptyHint: capSection.querySelector('.muted')?.textContent?.trim()?.slice(0, 30) || '',
    };
  });
  t(
    'release 阶段 chips 渲染真实 skill（release-checklist/release-ops）',
    !!releaseSection &&
      releaseSection.chips.length === 2 &&
      releaseSection.chips.includes('release-checklist') &&
      releaseSection.chips.includes('release-ops'),
    { releaseSection },
  );
  await page.screenshot({
    path: resolve(evidenceDir, 'panel-stage-caps-release-1440.png'),
    fullPage: false,
  });
  await browser.close();
  report.status = report.tests.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS';
} catch (e) {
  report.errors.push(String(e.message || e));
  report.status = 'FAIL';
}
writeFileSync(
  resolve(projectRoot, 'docs/quality-gate/reports/ai-tools-integration-20260914', 'stage-caps-panel-' + Date.now() + '.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ status: report.status, tests: report.tests.length, errors: report.errors, external: report.external }));
