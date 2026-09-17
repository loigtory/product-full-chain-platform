import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  repoRoot,
  evidenceRoot,
  hash,
  runId,
} from '../test-data/ai-tools-remediation-fixture.mjs';
const entries = [
  ['model', 'server/verify-ai-tools-remediation-model.mjs', [], 'offline'],
  [
    'api',
    'server/verify-ai-tools-remediation-api.mjs',
    ['--pg'],
    'integration',
  ],
  [
    'ops',
    'server/verify-ai-tools-remediation-ops.mjs',
    ['--pg'],
    'integration',
  ],
  [
    'browser',
    'output/pfc-workbench-prototype/verify-ai-tools-remediation-browser.mjs',
    [],
    'integration',
  ],
  ['real', 'server/verify-ai-tools-remediation-real.mjs', ['--real'], 'real'],
  ...[
    'verify-prototype.mjs',
    'verify-m1-layer.mjs',
    'verify-m1-e2e.mjs',
    'verify-m2b2-model.mjs',
    'verify-m2b2-browser.mjs',
  ].map((f) => [f, 'output/pfc-workbench-prototype/' + f, [], 'offline']),
  ...[
    'verify-server.mjs',
    'verify-server-m2.mjs',
    'verify-m2b.mjs',
    'verify-m2b2-domain.mjs',
  ].map((f) => [f, 'server/' + f, [], 'offline']),
  [
    'architecture',
    'server/verify-ai-tools-remediation-architecture.mjs',
    [],
    'offline',
  ],
];
const pkg = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      'docs/quality-gate/reports/ai-tools-remediation-plan-20260916/implementation-package.json',
    ),
  ),
);
const extra = JSON.parse(
  fs.readFileSync(
    path.join(
      evidenceRoot,
      'scope-amendment-connection-preflight-confirmed.json',
    ),
  ),
).files;
const manifest = () =>
  [...pkg.entries, ...extra]
    .filter((x) => fs.existsSync(path.join(repoRoot, x.path)))
    .map((x) => ({
      path: x.path,
      sha256: hash(fs.readFileSync(path.join(repoRoot, x.path))),
    }));
if (
  process.argv.includes('--dry-run') ||
  !process.argv.some((x) =>
    ['--offline', '--integration', '--real'].includes(x),
  )
) {
  console.log(
    JSON.stringify({
      status: 'PLAN_ONLY',
      runId,
      entries,
      realTurns: 'at most 8 including failures/retries',
      targets: [
        'codex_test_ai_fix_20260916_api',
        'codex_test_ai_fix_20260916_ops',
        'codex_test_ai_fix_20260916_browser',
      ],
      output: path.relative(repoRoot, evidenceRoot),
      historicalEvidence:
        'Preserved; legacy output redirected via scoped preload',
    }),
  );
} else {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const results = [];
  for (const [name, file, args, group] of entries) {
    if (!process.argv.includes('--' + group)) {
      results.push({ name, status: 'BLOCKED', reason: 'NOT_SELECTED' });
      continue;
    }
    const started = Date.now(),
      sources = manifest();
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(repoRoot, file), ...args],
        {
          cwd: path.dirname(path.join(repoRoot, file)),
          windowsHide: true,
          env: {
            ...process.env,
            PFC_REMEDIATION_EVIDENCE: name.endsWith('.mjs') ? '46' : '',
            PFC_REMEDIATION_LEGACY_ATTEMPT:
              String(started) + '-' + name.replaceAll('.', '-'),
            NODE_OPTIONS: name.endsWith('.mjs')
              ? '--import=' +
                pathToFileURL(
                  path.join(repoRoot, 'server/test-support/gate-result.mjs'),
                ).href
              : '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '',
        stderr = '',
        timer;
      child.stdout.on('data', (b) => {
        stdout += b;
        if (stdout.length > 4000000) child.kill();
      });
      child.stderr.on('data', (b) => {
        stderr += b;
        if (stderr.length > 1000000) child.kill();
      });
      timer = setTimeout(
        () => child.kill(),
        group === 'real' ? 1500000 : 600000,
      );
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          error: e.code,
          stdout,
          stderr,
          pid: child.pid,
        });
      });
      child.on('exit', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({ exitCode, signal, stdout, stderr, pid: child.pid });
      });
    });
    const row = {
      name,
      file,
      args,
      started,
      durationMs: Date.now() - started,
      ...result,
      source: sources,
      status:
        result.exitCode === 0
          ? 'PASS'
          : result.exitCode === 2
            ? 'BLOCKED'
            : 'FAIL',
    };
    // A successful process exit never upgrades an explicitly BLOCKED or FAIL result.
    for (const line of result.stdout.trim().split(/\r?\n/)) {
      try {
        const item = JSON.parse(line);
        if (item.status === 'FAIL') row.status = 'FAIL';
        else if (
          ['BLOCKED', 'PLAN_ONLY', 'HISTORICAL'].includes(item.status) &&
          row.status === 'PASS'
        )
          row.status = 'BLOCKED';
      } catch {
        /* Non-authoritative diagnostic/readiness output cannot establish success. */
      }
    }
    row.sourceUnchanged =
      JSON.stringify(sources) === JSON.stringify(manifest());
    if (!row.sourceUnchanged) row.status = 'FAIL';
    fs.writeFileSync(
      path.join(
        evidenceRoot,
        'command-' + name.replaceAll('.', '-') + '-' + started + '.json',
      ),
      JSON.stringify(row, null, 2) + '\n',
    );
    results.push({
      name,
      status: row.status,
      exitCode: row.exitCode,
      durationMs: row.durationMs,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  const status = results.every((x) => x.status === 'PASS')
    ? 'PASS'
    : results.some((x) => x.status === 'FAIL')
      ? 'FAIL'
      : 'BLOCKED';
  fs.writeFileSync(
    path.join(evidenceRoot, 'gates-' + Date.now() + '.json'),
    JSON.stringify({ runId, status, results }, null, 2) + '\n',
  );
  process.exitCode = status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1;
}
