import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, statSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const evidence = resolve(root, '../../docs/quality-gate/reports/local-use-baseline-20260913/legacy');
mkdirSync(evidence, { recursive: true });
const temporary = [];
const html = readFileSync(join(root, 'index.html'), 'utf8');
const files = [
  'index.html',
  ...[...html.matchAll(/(?:src|href)="(original\/[^"]+)"/g)].map((m) => m[1]),
];
const manifest = () =>
  files.map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex'),
  }));
const source = manifest();
const results = [];
for (const script of [
  'verify-static.mjs',
  'verify-integrity.mjs',
  'verify-guide-model.mjs',
  'verify-production.cjs',
  'verify-guide-browser.mjs',
  'verify-scope7.mjs',
]) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(root, script)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = run.stdout || '',
    stderr = run.stderr || '';
  writeFileSync(join(evidence, script + '-output.json'), JSON.stringify({ stdout, stderr, started, exitCode: run.status }, null, 2));
  let details;
  try {
    details = JSON.parse(stdout.trim().split('\n').at(-1));
  } catch {
    details = { error: run.error?.message || stderr.slice(-2000) };
  }
  if (typeof details.evidence === 'string') {
    const path = resolve(details.evidence), rel = relative(resolve(tmpdir()), path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !/^pfc-(remediation|guide|scope7)-/.test(basename(path)) || lstatSync(path).isSymbolicLink() || statSync(path).birthtimeMs < started - 2000) throw Error('LEGACY_TEMP_NOT_OWNED');
    for (const name of readdirSync(path)) {
      const file = join(path, name), st = lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink()) throw Error('LEGACY_TEMP_NOT_REGULAR');
      if (/\.(json|png)$/.test(name)) copyFileSync(file, join(evidence, script + '-' + name));
    }
    rmSync(path, { recursive: true });
    if (existsSync(path)) throw Error('LEGACY_TEMP_REMAINS');
    temporary.push({ path, createdAfter: started, removed: true });
  }
  const result = {
    script,
    status: run.status === 0 ? 'PASS' : 'FAIL',
    exitCode: run.status,
    details,
  };
  results.push(result);
  console.log(
    JSON.stringify({
      script,
      status: result.status,
      checks: details.checks || details.passed || details.results?.length,
      evidence: details.evidence,
    }),
  );
  if (run.status !== 0) break;
}
const sourceUnchanged = JSON.stringify(manifest()) === JSON.stringify(source);
const report = {
  status:
    results.length === 6 &&
    results.every((r) => r.status === 'PASS') &&
    sourceUnchanged
      ? 'PASS'
      : 'FAIL',
  at: new Date().toISOString(),
  source,
  sourceUnchanged,
  results,
  evidence,
  temporary,
  data: 'CODEx_TEST_ synthetic deterministic factories; isolated browser contexts closed; no external calls or database writes',
  scope:
    'Original standalone prototype only; project Quick/Core/Full and business acceptance are separate',
};
writeFileSync(
  join(evidence, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({ status: report.status, evidence, sourceUnchanged }),
);
process.exitCode = report.status === 'PASS' ? 0 : 1;
