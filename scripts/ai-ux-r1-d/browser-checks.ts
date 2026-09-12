import path from 'node:path';

import { chromium, type Page } from 'playwright';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compact(value: string | null, fallback: string) {
  if (!value) return fallback;
  return value.length > 24
    ? `${value.slice(0, 10)}...${value.slice(-7)}`
    : value;
}

function evidenceValue(
  evidence: Record<string, unknown>,
  tool: 'Codex' | 'Bridge' | 'Zed' | 'Git',
) {
  const status = evidence.evidenceStatus;
  const verified = status === 'VERIFIED';
  const problem =
    status === 'EXPIRED'
      ? '证据已过期'
      : status === 'MISMATCHED'
        ? '工作区不匹配'
        : '未核验';
  const gitVerified = Boolean(
    ['VERIFIED', 'EXPIRED'].includes(String(status)) &&
    evidence.verificationStatus === 'VERIFIED' &&
    typeof evidence.bindingGitBaseline === 'string' &&
    typeof evidence.capabilityGitBaseline === 'string' &&
    evidence.bindingGitBaseline.toLowerCase() ===
      evidence.capabilityGitBaseline.toLowerCase(),
  );
  if (tool === 'Git') {
    const value = gitVerified
      ? compact(String(evidence.capabilityGitBaseline), 'Git 基线未提供')
      : status === 'EXPIRED'
        ? 'Git 证据已过期'
        : status === 'MISMATCHED'
          ? 'Git 基线不一致'
          : 'Git 基线未核验';
    return { available: gitVerified, value };
  }
  if (tool === 'Codex') {
    const available = verified && evidence.codexAppServer === 'AVAILABLE';
    return {
      available,
      value: available ? 'Codex 已连接' : `Codex ${problem}`,
    };
  }
  if (tool === 'Bridge') {
    const available =
      verified &&
      evidence.bridgeStatus === 'ONLINE' &&
      evidence.capabilityFreshness === 'CURRENT';
    return {
      available,
      value: available ? 'Bridge 已连接' : `Bridge ${problem}`,
    };
  }
  const available = verified && evidence.zedCli === 'AVAILABLE';
  return {
    available,
    value: available
      ? 'Zed 已连接'
      : verified && evidence.zedCli === 'UNAVAILABLE'
        ? 'Zed 未接入'
        : `Zed ${problem}`,
  };
}

async function boundingEvidence(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) return null;
  return {
    top: Math.round(box.y),
    right: Math.round(box.x + box.width),
    bottom: Math.round(box.y + box.height),
    left: Math.round(box.x),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

async function login(
  page: Page,
  baseUrl: string,
  login: { loginName: string; password: string },
) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号').fill(login.loginName);
  await page.getByLabel('密码').fill(login.password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('heading', { name: '登录工作台' }).waitFor({
    state: 'hidden',
  });
}

async function layoutEvidence(
  page: Page,
  width: number,
  requireComposerFocus: boolean,
) {
  const composer = page.getByRole('textbox', { name: '给产品 Agent 的任务' });
  await composer.waitFor();
  const composerDisabled = await composer.isDisabled();
  if (!composerDisabled) {
    await page.getByRole('button', { name: '继续作业' }).click();
  }
  const focused = await composer.evaluate(
    (element) => document.activeElement === element,
  );
  const [
    shell,
    globalHeader,
    contextHeader,
    lifecycle,
    workspaceRect,
    stream,
    artifact,
    evidenceBar,
  ] = await Promise.all([
    boundingEvidence(page, '.pfc-agent-workspace-shell'),
    boundingEvidence(page, '.pfc-global-header'),
    boundingEvidence(page, '.pfc-requirement-context-header'),
    boundingEvidence(page, '.pfc-lifecycle-rail'),
    boundingEvidence(page, '.pfc-agent-workspace'),
    boundingEvidence(page, '.pfc-agent-workspace__stream'),
    boundingEvidence(page, '.pfc-agent-workspace__artifact'),
    boundingEvidence(page, '.pfc-evidence-bar'),
  ]);
  const computed = await page.evaluate(() => {
    const shell = document.querySelector('.pfc-agent-workspace-shell');
    const workspace = document.querySelector('.pfc-agent-workspace');
    const context = document.querySelector('.pfc-agent-workspace__context');
    const lifecycleItems = document.querySelectorAll('.pfc-lifecycle-rail li');
    const style = workspace ? getComputedStyle(workspace) : null;
    const contextStyle = context ? getComputedStyle(context) : null;
    return {
      contextDisplay: contextStyle?.display ?? 'missing',
      gridTemplateColumns: style?.gridTemplateColumns ?? 'missing',
      lifecycleItemCount: lifecycleItems.length,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      fontFamily: shell ? getComputedStyle(shell).fontFamily : 'missing',
    };
  });
  const evidence = {
    shell,
    globalHeader,
    contextHeader,
    lifecycle,
    workspace: workspaceRect,
    stream,
    artifact,
    evidence: evidenceBar,
    ...computed,
  };
  if (
    (!composerDisabled && !focused) ||
    (requireComposerFocus && (composerDisabled || !focused))
  ) {
    throw new Error(`AIUX_D_COMPOSER_FOCUS_INVALID_${width}`);
  }
  const ordered = [
    evidence.globalHeader,
    evidence.contextHeader,
    evidence.lifecycle,
    evidence.workspace,
    evidence.evidence,
  ];
  if (ordered.some((item) => item === null)) {
    throw new Error(`AIUX_D_LAYOUT_REGION_MISSING_${width}`);
  }
  for (let index = 0; index < ordered.length - 1; index += 1) {
    if (ordered[index]!.bottom > ordered[index + 1]!.top + 1) {
      throw new Error(`AIUX_D_LAYOUT_OVERLAP_${width}_${index}`);
    }
  }
  if (
    evidence.horizontalOverflow ||
    evidence.lifecycleItemCount !== 13 ||
    !evidence.stream?.width ||
    !evidence.artifact?.width
  ) {
    throw new Error(`AIUX_D_LAYOUT_INVALID_${width}`);
  }
  const contextModeInvalid =
    width >= 1600
      ? evidence.contextDisplay === 'none'
      : evidence.contextDisplay !== 'none';
  if (contextModeInvalid) {
    throw new Error(`AIUX_D_CONTEXT_MODE_INVALID_${width}`);
  }
  return { ...evidence, composerDisabled, composerFocused: focused };
}

export async function runAIUXBrowserChecks(input: {
  baseUrl: string;
  login: { loginName: string; password: string };
  outputDirectory: string;
  requirementId: string;
  sessionId: string;
  expectedEvidence?: {
    status: 'VERIFIED' | 'MISSING' | 'EXPIRED' | 'MISMATCHED';
    gitBaseline: string;
  };
  requireComposerFocus?: boolean;
}) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors: string[] = [];
  const viewports: Array<Record<string, unknown>> = [];
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
      const pageErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location();
        pageErrors.push(
          `${message.text()}${location.url ? ` @ ${location.url}` : ''}`,
        );
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await login(page, input.baseUrl, input.login);
      const requirementResponse = await page.request.get(
        `${input.baseUrl}/api/v1/requirements/${encodeURIComponent(input.requirementId)}`,
      );
      const requirement: unknown = await requirementResponse
        .json()
        .catch(() => null);
      if (
        !requirementResponse.ok() ||
        !record(requirement) ||
        typeof requirement.name !== 'string' ||
        !requirement.name.trim()
      ) {
        throw new Error(
          `AIUX_D_REQUIREMENT_READ_FAILED_${viewport.width}:${requirementResponse.status()}`,
        );
      }
      const snapshotResponse = await page.request.get(
        `${input.baseUrl}/api/v1/work-sessions/${encodeURIComponent(input.sessionId)}`,
      );
      const snapshot: unknown = await snapshotResponse.json().catch(() => null);
      const evidence = record(snapshot)
        ? record(snapshot.workspaceEvidence)
          ? snapshot.workspaceEvidence
          : null
        : null;
      if (!snapshotResponse.ok() || !evidence) {
        throw new Error(
          `AIUX_D_WORKSPACE_EVIDENCE_READ_FAILED_${viewport.width}:${snapshotResponse.status()}`,
        );
      }
      if (
        input.expectedEvidence &&
        (evidence.evidenceStatus !== input.expectedEvidence.status ||
          evidence.bindingGitBaseline !== input.expectedEvidence.gitBaseline ||
          evidence.capabilityGitBaseline !== input.expectedEvidence.gitBaseline)
      ) {
        throw new Error(
          `AIUX_D_WORKSPACE_EVIDENCE_MISMATCH_${viewport.width}:${String(evidence.evidenceStatus)}`,
        );
      }
      pageErrors.length = 0;
      await page.goto(
        `${input.baseUrl}/requirements/${encodeURIComponent(input.requirementId)}/work?session=${encodeURIComponent(input.sessionId)}&focus=work-stream`,
        { waitUntil: 'domcontentloaded' },
      );
      await page
        .getByRole('heading', { name: requirement.name, exact: true })
        .waitFor();
      await page.getByRole('heading', { name: 'Agent 作业流' }).waitFor();
      await page.locator('.pfc-work-message[data-actor="agent"]').waitFor();
      await page.getByText('MCP 未接入', { exact: true }).waitFor();
      const expectedTools = (['Codex', 'Bridge', 'Zed', 'Git'] as const).map(
        (tool) => ({ tool, ...evidenceValue(evidence, tool) }),
      );
      for (const expected of expectedTools) {
        await page.getByText(expected.value, { exact: true }).waitFor();
      }
      await page.getByText(/^(事件同步正常|正在重连事件同步)$/).waitFor();
      const gitEvidence = page
        .getByLabel('作业证据与工具状态')
        .locator('span')
        .filter({ has: page.getByText('Git', { exact: true }) });
      await gitEvidence.waitFor();
      const gitValue = await gitEvidence.locator('strong').textContent();
      const expectedGit = expectedTools.find((item) => item.tool === 'Git')!;
      if (
        (await gitEvidence.getAttribute('data-available')) !==
          String(expectedGit.available) ||
        gitValue !== expectedGit.value
      ) {
        throw new Error(
          `AIUX_D_GIT_EVIDENCE_INVALID_${viewport.width}:${gitValue ?? 'missing'}`,
        );
      }
      const [feedBox, responseBox] = await Promise.all([
        page.locator('.pfc-work-stream__feed').boundingBox(),
        page
          .locator('.pfc-work-message[data-actor="agent"]')
          .last()
          .boundingBox(),
      ]);
      if (
        !feedBox ||
        !responseBox ||
        responseBox.y >= feedBox.y + feedBox.height ||
        responseBox.y + responseBox.height <= feedBox.y ||
        responseBox.y + responseBox.height > feedBox.y + feedBox.height + 1
      ) {
        throw new Error(
          `AIUX_D_RESPONSE_NOT_IN_FEED_VIEWPORT_${viewport.width}`,
        );
      }
      if (new URL(page.url()).searchParams.get('session') !== input.sessionId) {
        throw new Error(`AIUX_D_URL_SESSION_NOT_PRESERVED_${viewport.width}`);
      }
      if (viewport.width < 1600) {
        await page.getByRole('button', { name: '上下文' }).click();
        await page
          .locator('.pfc-agent-workspace__context')
          .waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '关闭上下文' }).click();
        await page
          .locator('.pfc-agent-workspace__context')
          .waitFor({ state: 'hidden' });
      }
      const layout = await layoutEvidence(
        page,
        viewport.width,
        input.requireComposerFocus ?? true,
      );
      viewports.push({
        width: viewport.width,
        height: viewport.height,
        ...layout,
      });
      const screenshot = `ai-workspace-${viewport.width}.png`;
      await page.screenshot({
        path: path.resolve(input.outputDirectory, screenshot),
        fullPage: false,
      });
      screenshots.push(screenshot);
      errors.push(...pageErrors);
      await context.close();
    }
    if (errors.length) {
      const summary = errors
        .slice(0, 6)
        .map((message) => message.replaceAll(/\s+/g, ' ').slice(0, 180))
        .join(' | ');
      throw new Error(
        `AIUX_D_BROWSER_CONSOLE_ERRORS_${errors.length}:${summary}`,
      );
    }
    return {
      browser: 'EDGE_PLAYWRIGHT',
      consoleErrors: 0,
      screenshots,
      viewports,
    } as const;
  } finally {
    await browser.close();
  }
}
