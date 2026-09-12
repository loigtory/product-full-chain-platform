import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers';

function parseOutputPath(argv) {
  const index = argv.indexOf('--output');
  return index === -1 ? null : resolve(argv[index + 1] ?? '');
}

function redact(value, workspaceRoot) {
  return String(value)
    .replaceAll(process.env.USERPROFILE ?? '<user-profile>', '<user-profile>')
    .replaceAll(workspaceRoot, '<workspace>')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(
      /((?:token|cookie|password|secret)\s*[=:]\s*)[^\s;]+/gi,
      '$1<redacted>',
    )
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://<redacted>');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function cleanup(root) {
  const resolvedRoot = resolve(root);
  if (
    !resolvedRoot.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !basename(resolvedRoot).startsWith('CODEx_TEST_M2_PROCESS_')
  ) {
    throw new Error('TEMP_WORKSPACE_BOUNDARY_INVALID');
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const root = await mkdtemp(join(tmpdir(), 'CODEx_TEST_M2_PROCESS_'));
  const parentScript = join(root, 'parent.mjs');
  let parent;
  try {
    await writeFile(
      parentScript,
      [
        "import { spawn } from 'node:child_process';",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
        'console.log(child.pid);',
        'setInterval(() => {}, 1000);',
        '',
      ].join('\n'),
      'utf8',
    );
    parent = spawn(process.execPath, [parentScript], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: parent.stdout });
    const grandchildPid = await Promise.race([
      new Promise((resolvePid) =>
        lines.once('line', (line) => resolvePid(Number.parseInt(line, 10))),
      ),
      wait(5_000).then(() => 0),
    ]);
    if (!grandchildPid) throw new Error('GRANDCHILD_PID_NOT_OBSERVED');
    const beforeCleanup = {
      parent: isAlive(parent.pid),
      grandchild: isAlive(grandchildPid),
    };
    const termination = spawnSync(
      'taskkill.exe',
      ['/PID', String(parent.pid), '/T', '/F'],
      { windowsHide: true, encoding: 'utf8' },
    );
    await wait(1_000);
    const afterCleanup = {
      parent: isAlive(parent.pid),
      grandchild: isAlive(grandchildPid),
    };

    const secrets = [
      'CODEx_TEST_BEARER_SECRET',
      'CODEx_TEST_COOKIE_SECRET',
      'CODEx_TEST_TOKEN_SECRET',
      'CODEx_TEST_PASSWORD_SECRET',
      'CODEx_TEST_DB_SECRET',
    ];
    const raw = [
      'Authorization: Bearer CODEx_TEST_BEARER_SECRET',
      'cookie=CODEx_TEST_COOKIE_SECRET; other=safe',
      'token=CODEx_TEST_TOKEN_SECRET',
      'password=CODEx_TEST_PASSWORD_SECRET',
      'postgresql://pfc:CODEx_TEST_DB_SECRET@127.0.0.1/pfc_local',
      join(process.env.USERPROFILE ?? 'C:\\Users\\synthetic', 'private.txt'),
      join(root, 'agent-output.txt'),
    ].join('\n');
    const redacted = redact(raw, root);
    const result = {
      runId: 'CODEx_TEST_M2_PROCESS_REDACTION_R1',
      processTreeAliveBeforeCleanup: beforeCleanup,
      taskkillExitCode: termination.status,
      processTreeAliveAfterCleanup: afterCleanup,
      redactionPassed:
        secrets.every((secret) => !redacted.includes(secret)) &&
        !redacted.includes(process.env.USERPROFILE ?? '__absent__') &&
        !redacted.includes(root),
      redactedOutputHash: createHash('sha256')
        .update(redacted)
        .digest('hex')
        .slice(0, 16),
      workspaceCleanup: 'PENDING',
    };
    const passed =
      beforeCleanup.parent &&
      beforeCleanup.grandchild &&
      termination.status === 0 &&
      !afterCleanup.parent &&
      !afterCleanup.grandchild &&
      result.redactionPassed;
    if (!passed)
      throw new Error(`PROCESS_INVARIANT_FAILED:${JSON.stringify(result)}`);
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
    if (parent?.exitCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(parent.pid), '/T', '/F'], {
        windowsHide: true,
      });
    }
    await cleanup(root);
    console.log('PFC_SPIKE_TEMP_CLEANED');
  }
}

await main();
