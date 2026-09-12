import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { asRecord } from './m2-r2-local-acceptance/http-client.ts';
import { m2R2AcceptancePaths } from './m2-r2-local-acceptance/local-files.ts';

const projectRoot = path.resolve(import.meta.dirname, '..');
const baseUrl = 'http://127.0.0.1:5173';
const paths = m2R2AcceptancePaths(projectRoot);
const outputDirectory = path.resolve(
  projectRoot,
  'output/playwright/m2-r2-real',
);
const accounts = asRecord(
  JSON.parse(await readFile(paths.accountsFile, 'utf8')),
);
const result = asRecord(
  JSON.parse(await readFile(paths.apiResultFile, 'utf8')),
);
const requester = asRecord(accounts.requester);
const approver = asRecord(accounts.approver);
const approved = asRecord(result.approved);
const cancelled = asRecord(result.cancelled);
const unknown = asRecord(result.unknown);

for (const [field, value] of [
  ['requester.loginName', requester.loginName],
  ['requester.password', requester.password],
  ['approver.loginName', approver.loginName],
  ['approver.password', approver.password],
  ['approved.runId', approved.runId],
  ['cancelled.runId', cancelled.runId],
  ['unknown.runId', unknown.runId],
] as const) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`M2_R2_BROWSER_INPUT_INVALID field=${field}`);
  }
}

async function login(page: Page, account: Record<string, unknown>) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号').fill(String(account.loginName));
  await page.getByLabel('密码').fill(String(account.password));
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('heading', { name: '需求工作台' }).waitFor();
}

async function openRun(page: Page, runId: string, statusLabel: string) {
  await page.goto(`${baseUrl}/jobs/${encodeURIComponent(runId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { name: '受控作业' }).waitFor();
  await page.getByText('执行上下文', { exact: true }).waitFor();
  await page.getByText(statusLabel, { exact: true }).first().waitFor();
  if (
    await page
      .getByText('本地数据库体验')
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error('M2_R2_BROWSER_EXPERIENCE_MODE_VISIBLE');
  }
}

async function inspectLayout(page: Page) {
  const refresh = page.getByRole('button', { name: '刷新作业数据' });
  await refresh.focus();
  return page.evaluate(() => {
    const header = document.querySelector('header')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement | null;
    const focusStyle = focused ? getComputedStyle(focused) : null;
    const clippedText = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, code, dd, h1, h2, h3, p, span, td, th',
      ),
    )
      .filter((element) => element.offsetParent !== null)
      .filter((element) => {
        const style = getComputedStyle(element);
        if (
          style.textOverflow === 'ellipsis' ||
          style.overflowWrap === 'anywhere'
        ) {
          return false;
        }
        return element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => element.textContent?.trim().slice(0, 48) ?? '');
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      headerMainOverlap: Boolean(
        header && main && header.bottom > main.top + 1,
      ),
      focusVisible: Boolean(
        focusStyle &&
        ((focusStyle.outline && focusStyle.outline !== 'none') ||
          (focusStyle.boxShadow && focusStyle.boxShadow !== 'none')),
      ),
      clippedText,
    };
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const browserErrors: string[] = [];
const viewports: Array<{
  width: number;
  fontFamily: string;
  horizontalOverflow: boolean;
  headerMainOverlap: boolean;
  focusVisible: boolean;
  clippedTextCount: number;
}> = [];
const screenshots: string[] = [];

try {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const context = await browser.newContext({
      viewport,
      locale: 'zh-CN',
      colorScheme: 'light',
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await login(page, requester);
    await openRun(page, String(approved.runId), '已完成');
    const layout = await inspectLayout(page);
    if (
      layout.horizontalOverflow ||
      layout.headerMainOverlap ||
      !layout.focusVisible ||
      layout.clippedText.length > 0
    ) {
      throw new Error(`M2_R2_BROWSER_LAYOUT_INVALID_${viewport.width}`);
    }
    viewports.push({
      width: viewport.width,
      fontFamily: layout.fontFamily,
      horizontalOverflow: layout.horizontalOverflow,
      headerMainOverlap: layout.headerMainOverlap,
      focusVisible: layout.focusVisible,
      clippedTextCount: layout.clippedText.length,
    });
    const approvedScreenshot = `approved-${viewport.width}.png`;
    await page.screenshot({
      path: path.resolve(outputDirectory, approvedScreenshot),
      fullPage: true,
    });
    screenshots.push(approvedScreenshot);

    if (viewport.width === 1440) {
      await openRun(page, String(unknown.runId), '状态待核验');
      await page.getByText(/当前无法证明执行结果/).waitFor();
      await page.screenshot({
        path: path.resolve(outputDirectory, 'unknown-1440.png'),
        fullPage: true,
      });
      screenshots.push('unknown-1440.png');
      await openRun(page, String(cancelled.runId), '已取消');
      await page.screenshot({
        path: path.resolve(outputDirectory, 'cancelled-1440.png'),
        fullPage: true,
      });
      screenshots.push('cancelled-1440.png');
    }
    await context.close();
  }

  const approvalContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    colorScheme: 'light',
  });
  const approvalPage = await approvalContext.newPage();
  approvalPage.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  approvalPage.on('pageerror', (error) => browserErrors.push(error.message));
  await login(approvalPage, approver);
  await approvalPage.goto(`${baseUrl}/jobs?view=approvals`, {
    waitUntil: 'domcontentloaded',
  });
  await approvalPage.getByRole('heading', { name: '受控作业' }).waitFor();
  await approvalPage.getByText('审批收件箱', { exact: true }).waitFor();
  await approvalPage.getByText('暂无待办审批', { exact: true }).waitFor();
  await approvalPage.screenshot({
    path: path.resolve(outputDirectory, 'approvals-1440.png'),
    fullPage: true,
  });
  screenshots.push('approvals-1440.png');
  await approvalContext.close();

  if (browserErrors.length > 0) {
    throw new Error(
      `M2_R2_BROWSER_CONSOLE_ERRORS count=${browserErrors.length}`,
    );
  }
  const browserResult = {
    status: 'PASS',
    dataSource: 'STANDARD_LOCAL_POSTGRESQL_VIA_API',
    actors: { requester: 'AUTHENTICATED', approver: 'AUTHENTICATED' },
    runs: {
      approved: { runId: approved.runId, status: approved.status },
      cancelled: { runId: cancelled.runId, status: cancelled.status },
      unknown: { runId: unknown.runId, status: unknown.status },
    },
    viewports,
    approvals: {
      pendingInboxEmpty: true,
      terminalDecisionsSource: 'STANDARD_LOCAL_POSTGRESQL_READBACK',
    },
    consoleErrors: 0,
    screenshots,
  } as const;
  await writeFile(
    paths.browserResultFile,
    `${JSON.stringify(browserResult, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(browserResult));
} finally {
  await browser.close();
}
