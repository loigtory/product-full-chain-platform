import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { parseM2BrowserExpectation } from './m2-local-acceptance/browser-expectation.ts';

type LocalLogin = Readonly<{
  loginName: string;
  password: string;
  requirementId: string;
}>;

const projectRoot = path.resolve(import.meta.dirname, '..');
const baseUrl = 'http://127.0.0.1:5173';
const outputDirectory = path.resolve(
  projectRoot,
  'output/playwright/m2-r1-real',
);
const resultFile = path.resolve(
  projectRoot,
  '.local/m2-acceptance/browser-result.json',
);
const login = JSON.parse(
  await readFile(
    path.resolve(projectRoot, '.local/m2-acceptance/login.json'),
    'utf8',
  ),
) as LocalLogin;
if (
  !login.loginName ||
  !login.password ||
  !login.requirementId.startsWith('CODEx_TEST_')
) {
  throw new Error('M2_BROWSER_LOGIN_FILE_INVALID');
}

async function loginToPlatform(page: Page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号').fill(login.loginName);
  await page.getByLabel('密码').fill(login.password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('heading', { name: '需求工作台' }).waitFor();
}

async function visualEvidence(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    const main = document.querySelector('main');
    const headerBox = header?.getBoundingClientRect();
    const mainBox = main?.getBoundingClientRect();
    const visibleText = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, code, dd, h1, h2, h3, p, small, span, td, th',
      ),
    ).filter(
      (element) =>
        element.offsetParent !== null && Boolean(element.textContent?.trim()),
    );
    const clippedText = visibleText
      .filter((element) => {
        if (getComputedStyle(element).textOverflow === 'ellipsis') return false;
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        const textBounds = textRange.getBoundingClientRect();
        const elementBounds = element.getBoundingClientRect();
        return (
          textBounds.left < elementBounds.left - 1 ||
          textBounds.right > elementBounds.right + 1
        );
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: element.textContent?.trim().slice(0, 60) ?? '',
      }));
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      headerMainOverlap: Boolean(
        headerBox && mainBox && headerBox.bottom > mainBox.top + 1,
      ),
      clippedText,
    };
  });
}

async function assertFocusVisible(page: Page) {
  const refresh = page.getByRole('button', { name: '刷新作业数据' });
  await refresh.focus();
  const focus = await refresh.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outline, boxShadow: style.boxShadow };
  });
  if (
    (!focus.outline || focus.outline === 'none') &&
    (!focus.boxShadow || focus.boxShadow === 'none')
  ) {
    throw new Error('M2_BROWSER_FOCUS_NOT_VISIBLE');
  }
}

async function waitForTerminalRun(page: Page) {
  const terminalLabels = new Set(['已完成', '失败', '已取消', '状态待核验']);
  for (let attempt = 0; attempt < 70; attempt += 1) {
    await page.getByRole('button', { name: '刷新作业数据' }).click();
    await page.waitForTimeout(2_000);
    const selectedRow = page.locator('.agent-run-list tr.is-selected');
    if (await selectedRow.isVisible().catch(() => false)) {
      const label = (await selectedRow.locator('td').nth(1).innerText()).trim();
      if (terminalLabels.has(label)) return label;
    }
  }
  throw new Error('M2_BROWSER_AGENT_RUN_TIMEOUT');
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(path.dirname(resultFile), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const browserErrors: string[] = [];
const evidence: Array<{
  width: number;
  fontFamily: string;
  horizontalOverflow: boolean;
  headerMainOverlap: boolean;
  clippedTextCount: number;
}> = [];
const expectation = parseM2BrowserExpectation(process.argv.slice(2));
let runId = expectation.runId;
if (runId && !runId.startsWith('CODEx_TEST_M2_R1_REAL_20260906_agent-run-')) {
  throw new Error('M2_BROWSER_AGENT_RUN_ID_INVALID');
}
let terminalLabel = '';

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

    await loginToPlatform(page);
    if (!runId) {
      await page.goto(
        `${baseUrl}/requirements/${encodeURIComponent(login.requirementId)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await page
        .getByRole('heading', {
          name: 'CODEx_TEST_M2_R1 真实只读产物检查',
        })
        .waitFor();
      if (
        await page
          .getByText('本地数据库体验')
          .isVisible()
          .catch(() => false)
      ) {
        throw new Error('M2_BROWSER_EXPERIENCE_MODE_VISIBLE');
      }
      await page.getByRole('button', { name: '运行只读检查' }).click();
      await page.getByText('Bridge 已验证', { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.resolve(outputDirectory, 'requirement-launch-1280.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: '启动只读检查' }).click();
      await page.waitForURL(/\/jobs\/[^/]+$/, { timeout: 15_000 });
      runId = decodeURIComponent(
        new URL(page.url()).pathname.split('/').at(-1)!,
      );
      if (!runId.startsWith('CODEx_TEST_M2_R1_REAL_20260906_agent-run-')) {
        throw new Error('M2_BROWSER_AGENT_RUN_ID_INVALID');
      }
      terminalLabel = await waitForTerminalRun(page);
      if (terminalLabel !== expectation.expectedTerminalLabel) {
        throw new Error(`M2_BROWSER_AGENT_RUN_TERMINAL_${terminalLabel}`);
      }
    } else {
      await page.goto(`${baseUrl}/jobs/${encodeURIComponent(runId)}`, {
        waitUntil: 'domcontentloaded',
      });
    }

    await page.getByRole('heading', { name: '受控作业' }).waitFor();
    await page.getByText('执行上下文', { exact: true }).waitFor();
    if (!terminalLabel) {
      terminalLabel = await waitForTerminalRun(page);
      if (terminalLabel !== expectation.expectedTerminalLabel) {
        throw new Error(`M2_BROWSER_AGENT_RUN_TERMINAL_${terminalLabel}`);
      }
    }
    await assertFocusVisible(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const visual = await visualEvidence(page);
    if (
      visual.horizontalOverflow ||
      visual.headerMainOverlap ||
      visual.clippedText.length
    ) {
      throw new Error(
        `M2_BROWSER_LAYOUT_INVALID_${viewport.width}_${JSON.stringify(visual)}`,
      );
    }
    evidence.push({
      width: viewport.width,
      fontFamily: visual.fontFamily,
      horizontalOverflow: visual.horizontalOverflow,
      headerMainOverlap: visual.headerMainOverlap,
      clippedTextCount: visual.clippedText.length,
    });
    await page.screenshot({
      path: path.resolve(outputDirectory, `agent-run-${viewport.width}.png`),
      fullPage: true,
    });

    if (viewport.width === 1440) {
      await page.getByRole('button', { name: 'Skills', exact: true }).click();
      await page.getByText('只读产物检查', { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.resolve(outputDirectory, 'skill-catalog-1440.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Bridge', exact: true }).click();
      await page.getByText('App Server 可用', { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.resolve(outputDirectory, 'bridge-center-1440.png'),
        fullPage: true,
      });
    }
    await context.close();
  }

  if (browserErrors.length) throw new Error('M2_BROWSER_CONSOLE_ERRORS');
  const result = {
    status: 'PASS',
    runId,
    terminalStatus: expectation.expectedTerminalStatus,
    terminalLabel,
    viewports: evidence,
    consoleErrors: browserErrors.length,
    screenshots: [
      'requirement-launch-1280.png',
      'agent-run-1280.png',
      'agent-run-1440.png',
      'agent-run-1920.png',
      'skill-catalog-1440.png',
      'bridge-center-1440.png',
    ],
  } as const;
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
