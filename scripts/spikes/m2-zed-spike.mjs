import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers';

const startupObservationMs = 8_000;

function parseOutputPath(argv) {
  const index = argv.indexOf('--output');
  return index === -1 ? null : resolve(argv[index + 1] ?? '');
}

function resolveZedCli() {
  return (
    process.env.PFC_ZED_CLI?.trim() || 'C:\\Program Files\\ZedG\\bin\\ZedG.exe'
  );
}

function resolveZedApplication(cli) {
  return (
    process.env.PFC_ZED_APPLICATION?.trim() ||
    join(dirname(dirname(cli)), 'ZedG.exe')
  );
}

function safeText(value) {
  return String(value)
    .replaceAll(process.env.USERPROFILE ?? '<user-profile>', '<user-profile>')
    .replace(
      /(token|cookie|authorization)["'=:\s]+[^\s,"'}]+/gi,
      '$1=<redacted>',
    )
    .slice(-2_000);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'CODEx_TEST_M2_ZED_'));
  const repository = join(root, 'repository');
  const userData = join(root, 'zed-user-data');
  await mkdir(repository, { recursive: true });
  await mkdir(userData, { recursive: true });
  const gitInit = spawnSync('git', ['init', '--quiet', repository], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (gitInit.status !== 0) {
    throw new Error(`GIT_INIT_FAILED:${safeText(gitInit.stderr)}`);
  }
  const oldFile = join(repository, 'before.txt');
  const newFile = join(repository, 'after.txt');
  await writeFile(oldFile, 'PFC Zed Spike\nold value\n', 'utf8');
  await writeFile(newFile, 'PFC Zed Spike\nnew value\n', 'utf8');
  return { root, repository, userData, oldFile, newFile };
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key.toLowerCase());
    collectKeys(child, keys);
  }
  return keys;
}

async function detectExternalAgentConfiguration() {
  const appData = process.env.APPDATA?.trim();
  if (!appData) return { settingsDetected: false, acpConfigKeyDetected: false };
  const settingsPath = join(appData, 'Zed', 'settings.json');
  try {
    const settingsText = await readFile(settingsPath, 'utf8');
    let keys;
    try {
      keys = collectKeys(JSON.parse(settingsText));
    } catch {
      keys = new Set(
        [...settingsText.matchAll(/["']?([A-Za-z][\w-]*)["']?\s*:/g)].map(
          (match) => match[1].toLowerCase(),
        ),
      );
    }
    return {
      settingsDetected: true,
      acpConfigKeyDetected: [
        'agent_servers',
        'agentservers',
        'external_agents',
        'externalagents',
      ].some((key) => keys.has(key)),
    };
  } catch {
    return { settingsDetected: false, acpConfigKeyDetected: false };
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function stopOwnedProcess(child) {
  if (child.exitCode !== null) return 'EXITED';
  const result = spawnSync(
    'taskkill.exe',
    ['/PID', String(child.pid), '/T', '/F'],
    {
      windowsHide: true,
      encoding: 'utf8',
    },
  );
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(5_000),
  ]);
  return result.status === 0 && child.exitCode !== null
    ? 'PROCESS_TREE_TERMINATED'
    : 'PROCESS_TREE_CLEANUP_FAILED';
}

async function cleanupWorkspace(root) {
  const resolvedRoot = resolve(root);
  if (
    !resolvedRoot.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !basename(resolvedRoot).startsWith('CODEx_TEST_M2_ZED_')
  ) {
    throw new Error('TEMP_WORKSPACE_BOUNDARY_INVALID');
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const cli = resolveZedCli();
  const application = resolveZedApplication(cli);
  const workspace = await createWorkspace();
  let child;
  try {
    const version = spawnSync(cli, ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (version.status !== 0) {
      throw new Error(`ZED_VERSION_FAILED:${safeText(version.stderr)}`);
    }
    const externalAgent = await detectExternalAgentConfiguration();
    const stdout = [];
    const stderr = [];
    child = spawn(
      application,
      [
        '--foreground',
        '--user-data-dir',
        workspace.userData,
        '--new',
        `${workspace.newFile}:2:1`,
        workspace.repository,
        '--diff',
        workspace.oldFile,
        workspace.newFile,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(safeText(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(safeText(chunk)));
    await wait(startupObservationMs);
    const survivedStartup = child.exitCode === null;
    const processCleanup = await stopOwnedProcess(child);
    const cliDispatchAccepted = survivedStartup || child.exitCode === 0;
    const result = {
      runId: 'CODEx_TEST_M2_ZED_R1',
      cliVersionHash: hash(version.stdout.trim()),
      repositoryDispatch: cliDispatchAccepted ? 'CLI_ACCEPTED' : 'FAILED',
      lineColumnDispatch: cliDispatchAccepted ? 'CLI_ACCEPTED' : 'FAILED',
      diffDispatch: cliDispatchAccepted ? 'CLI_ACCEPTED' : 'FAILED',
      visualVerification: 'PENDING_HUMAN_OBSERVATION',
      settingsDetected: externalAgent.settingsDetected,
      acpConfigKeyDetected: externalAgent.acpConfigKeyDetected,
      acpIntegrationClaim: 'CONFIG_KEY_ONLY_NOT_CONNECTED',
      startupLogObserved: stdout.length + stderr.length > 0,
      fatalStartupMarker: /\b(fatal|panic)\b/i.test(
        `${stdout.join('\n')}\n${stderr.join('\n')}`,
      ),
      processCleanup,
      workspaceCleanup: 'PENDING',
    };
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
    }
    console.log(JSON.stringify(result));
  } finally {
    if (child?.exitCode === null) await stopOwnedProcess(child);
    await cleanupWorkspace(workspace.root);
    console.log('PFC_SPIKE_TEMP_CLEANED');
  }
}

await main();
