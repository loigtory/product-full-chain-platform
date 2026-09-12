import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runAIUXBrowserChecks } from './ai-ux-r1-d/browser-checks.ts';
import { startAIUXBrowserHarness } from './ai-ux-r1-d/local-harness.ts';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.resolve(
  projectRoot,
  'output',
  'playwright',
  'ai-ux-r1-d',
);
const reportPath = path.resolve(
  projectRoot,
  'docs',
  'quality-gate',
  'reports',
  '2026-09-07-ai-ux-r1-d-browser.json',
);
const baseUrl = 'http://127.0.0.1:5173';
let vite: ChildProcess | null = null;
let viteExited = false;
let harness: Awaited<ReturnType<typeof startAIUXBrowserHarness>> | null = null;
let failure: unknown;
let report: Record<string, unknown> = {};

async function waitForWeb(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Vite listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('AIUX_D_VITE_START_TIMEOUT');
}

async function stopVite() {
  if (!vite || viteExited) return 'CLOSED' as const;
  vite.kill();
  await Promise.race([
    new Promise<void>((resolve) => vite?.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!viteExited && vite.pid) {
    try {
      process.kill(vite.pid);
    } catch {
      // The process exited between checks.
    }
  }
  return 'CLOSED' as const;
}

try {
  await mkdir(outputDirectory, { recursive: true });
  harness = await startAIUXBrowserHarness();
  const viteEnv = { ...process.env };
  delete viteEnv.VITE_TEST_RUN_ID;
  delete viteEnv.PFC_EXPERIENCE_MODE;
  vite = spawn(
    process.execPath,
    [
      path.resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    {
      cwd: path.resolve(projectRoot, 'apps', 'web'),
      env: viteEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  vite.once('exit', () => {
    viteExited = true;
  });
  await waitForWeb(baseUrl);
  const browser = await runAIUXBrowserChecks({
    baseUrl,
    login: harness.login,
    outputDirectory,
    requirementId: harness.evidence.requirementId,
    sessionId: harness.evidence.sessionId,
  });
  report = {
    status: 'PASS',
    parentPOD: 'POD-PFC-001',
    milestone: 'M2',
    scope: 'AI-UX-R1-D',
    environment: 'LOCAL_ISOLATED_POSTGRESQL',
    dataSource: 'DETERMINISTIC_SYNTHETIC_PRODUCT_FACTS',
    agentExecution: 'REAL_LOCAL_BRIDGE_AND_CODEX_APP_SERVER',
    protocolVersion: 'product-work-turn/1',
    testDataDesign: {
      scenario:
        'completed product discovery turn with authorized INTERNAL material',
      riskCovered: [
        'server-owned-work-session-state',
        'real-context-transmission',
        'three-width-layout',
        'keyboard-focus',
        'unavailable-capability-honesty',
        'url-session-preservation',
      ],
      construction: 'createAIWorkSessionTestData with isolated schema',
      businessValidity:
        'synthetic requirement, baseline, material, role, grant, Skill and Bridge satisfy the same repository invariants as product facts',
      sensitiveData: 'NONE_SYNTHETIC_ONLY',
      isolation: harness.evidence.schemaName,
      cleanup: 'DROPPED_AND_READ_BACK_IN_FINALLY',
    },
    createdIds: {
      runId: harness.evidence.runId,
      requirementId: harness.evidence.requirementId,
      sessionId: harness.evidence.sessionId,
      turnId: harness.evidence.turnId,
    },
    agentReadback: {
      turnStatus: harness.evidence.turnStatus,
      visibleResponsePresent: harness.evidence.responsePresent,
      externalThreadHash: harness.evidence.externalThreadHash,
      skillReleaseId: harness.evidence.skillReleaseId,
      skillContentHash: harness.evidence.skillContentHash,
      bridgeId: harness.evidence.bridgeId,
    },
    browser,
    visualAcceptance: 'PENDING_PRODUCT_OWNER_REVIEW',
    standardPfcMigrations006007: 'NOT_APPLIED_NOT_AUTHORIZED',
    tooling:
      'project Playwright used because no Build Web Apps browser plugin was exposed in this session',
  };
} catch (error) {
  failure = error;
  report = {
    status: 'FAIL',
    parentPOD: 'POD-PFC-001',
    milestone: 'M2',
    scope: 'AI-UX-R1-D',
    failureCode:
      error instanceof Error && /^[A-Z][A-Z0-9_:=-]*/.test(error.message)
        ? error.message.slice(0, 180)
        : 'AIUX_D_UNCLASSIFIED_FAILURE',
  };
} finally {
  const web = await stopVite();
  const local = harness
    ? await harness.close()
    : {
        api: 'NOT_STARTED',
        appServers: 'NOT_STARTED',
        schemaRemainingTableCount: 'UNKNOWN',
        syntheticWorkspace: 'NOT_STARTED',
      };
  report.cleanup = {
    web,
    browser: 'CLOSED_IN_BROWSER_CHECKS',
    ...local,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report));
if (failure) throw failure;
