import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:5173';
const runId = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const requirementName = `CODEx_TEST_EXPERIENCE_LIVE_${runId}_完整需求`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failures.push(`http:${response.status()}:${response.url()}`);
    }
  });

  await page.goto(`${baseUrl}/?scope=ALL&view=TABLE`, {
    waitUntil: 'networkidle',
  });
  await page.getByText('本地数据库体验', { exact: true }).waitFor();
  await page.getByText('体验：可执行门禁的结算规则').waitFor();

  const artifactDirectory = resolve('output/playwright');
  await mkdir(artifactDirectory, { recursive: true });
  const gateResponse = await page.request.get(
    `${baseUrl}/api/v1/gate-center?view=CURRENT&limit=20`,
  );
  if (!gateResponse.ok()) throw new Error('EXPERIENCE_GATE_CENTER_API_FAILED');
  const gatePayload = (await gateResponse.json()) as {
    items?: Array<{ requirementName?: string }>;
  };
  await page.getByRole('button', { name: '门禁中心' }).click();
  await page.getByRole('heading', { name: '门禁中心' }).waitFor();
  if (
    !gatePayload.items?.some(
      (item) => item.requirementName === '体验：材料变更影响评估',
    )
  ) {
    throw new Error('EXPERIENCE_GATE_CENTER_READBACK_MISSING');
  }
  await page.getByRole('button', { name: '体验：材料变更影响评估' }).waitFor();
  await page.screenshot({
    path: resolve(artifactDirectory, 'local-experience-gate-center.png'),
    fullPage: true,
  });

  const materialResponse = await page.request.get(
    `${baseUrl}/api/v1/material-library?limit=20`,
  );
  if (!materialResponse.ok())
    throw new Error('EXPERIENCE_MATERIAL_LIBRARY_API_FAILED');
  const materialPayload = (await materialResponse.json()) as {
    items?: Array<{
      requirementName?: string;
      status?: string;
      pendingImpact?: { status?: string } | null;
    }>;
  };
  await page.getByRole('button', { name: '材料库' }).click();
  await page.getByRole('heading', { name: '材料库' }).waitFor();
  if (
    !materialPayload.items?.some(
      (item) =>
        item.requirementName === '体验：材料变更影响评估' &&
        item.status === 'CANDIDATE' &&
        item.pendingImpact?.status === 'PENDING',
    )
  ) {
    throw new Error('EXPERIENCE_MATERIAL_LIBRARY_READBACK_MISSING');
  }
  await page.getByLabel('基线状态').selectOption('CANDIDATE');
  await page.getByText('待确认 · 建议回退 G1').waitFor();
  await page.screenshot({
    path: resolve(artifactDirectory, 'local-experience-material-library.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '需求工作台' }).click();
  await page.getByText('体验：可执行门禁的结算规则').waitFor();

  await page.getByRole('button', { name: '新建需求' }).click();
  await page.getByLabel('需求名称').fill(requirementName);
  await page
    .getByLabel('原始想法')
    .fill('验证本地 PostgreSQL 写入、门禁推进与刷新后读回。');
  await page.getByText('同时填写 G0 登记信息').click();
  await page.getByLabel('来源').selectOption('BUSINESS_FEEDBACK');
  await page.getByLabel('材料用途').selectOption('FACT');
  await page.getByLabel('内部普通').check();
  const owner = page.getByLabel('业务责任人');
  const ownerEditable = await owner.isEditable();
  if (
    (await owner.inputValue()) !== 'CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS' ||
    ownerEditable
  ) {
    throw new Error('EXPERIENCE_OWNER_BOUNDARY_INVALID');
  }
  await page.getByRole('button', { name: '保存草稿' }).click();
  await page.getByText('G0 登记已完整').waitFor();

  const requirementId = decodeURIComponent(
    new URL(page.url()).pathname.split('/').at(-1) ?? '',
  );
  if (!requirementId.startsWith('CODEx_TEST_EXPERIENCE_REQUIREMENT_')) {
    throw new Error('EXPERIENCE_REQUIREMENT_ID_INVALID');
  }

  await page.getByRole('button', { name: '运行自动门禁' }).click();
  const currentStage = page.locator(
    '[aria-label="需求生命周期"] [aria-current="step"]',
  );
  await currentStage.getByText('G1', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: requirementName }).waitFor();
  await currentStage.getByText('G1', { exact: true }).waitFor();

  await page.getByRole('button', { name: '返回需求工作台' }).click();
  await page.getByText('体验：可执行门禁的结算规则').click();
  const openQuestion = 'OPEN：本版本采用哪种结算口径？';
  await page.getByRole('button', { name: `处理问题：${openQuestion}` }).click();
  const questionDialog = page.getByRole('dialog', { name: '问题与决定' });
  await questionDialog.getByRole('button', { name: '按实结算' }).click();
  await questionDialog
    .getByText('回答说明')
    .locator('..')
    .getByRole('textbox')
    .fill('本地体验验收使用确定性合成口径。');
  await questionDialog.getByRole('button', { name: '保存原始回答' }).click();
  await questionDialog.getByText('已保存：已回答').waitFor();
  await questionDialog.getByRole('button', { name: '确认当前回答' }).click();
  await questionDialog.getByText('已保存：已确认').waitFor();
  await questionDialog.getByRole('button', { name: '关闭问题与决定' }).click();

  await page.getByRole('button', { name: '返回需求工作台' }).click();
  await page.getByText('体验：材料变更影响评估').click();
  await page.getByText('待确认', { exact: true }).waitFor();
  await page.getByRole('button', { name: '确认影响' }).click();
  await page.getByText('不影响现有结论', { exact: true }).click();
  await page
    .getByLabel('确认原因')
    .fill('新增材料只补充既有事实，不改变当前结论。');
  await page.getByRole('button', { name: '确认并切换基线' }).click();
  await page.getByText('确认不影响', { exact: true }).waitFor();

  await page.screenshot({
    path: resolve(artifactDirectory, 'local-experience-desktop.png'),
    fullPage: true,
  });
  if (failures.length > 0) {
    throw new Error(`EXPERIENCE_BROWSER_FAILURES:${failures.join('|')}`);
  }
  console.log(
    `EXPERIENCE_BROWSER_PASS requirementId=${requirementId} gateCenter=PASS materialLibrary=PASS stage=G1 reload=PASS question=CONFIRMED materialImpact=NO_IMPACT consoleErrors=0 httpErrors=0`,
  );
} finally {
  await browser.close();
}
