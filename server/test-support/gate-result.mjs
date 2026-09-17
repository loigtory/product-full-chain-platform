export function assertion(name, ok, extra = {}) {
  const { status: observedStatus, name: observedName, ...details } = extra;
  return {
    ...details,
    ...(observedStatus === undefined ? {} : { observedStatus }),
    ...(observedName === undefined ? {} : { observedName }),
    name,
    status: ok === true ? 'PASS' : 'FAIL',
  };
}

export function summarize(report) {
  const tests = report.tests ?? report.results;
  if (
    (report.errors?.length ?? 0) ||
    report.error ||
    (report.exitCode !== undefined && report.exitCode !== 0)
  )
    return 'FAIL';
  if (!Array.isArray(tests) || !tests.length) return 'BLOCKED';
  if (tests.some((t) => t.status === 'FAIL')) return 'FAIL';
  if (tests.some((t) => t.status !== 'PASS')) return 'BLOCKED';
  if (
    report.cleanup &&
    typeof report.cleanup === 'object' &&
    report.cleanup.status !== 'PASS'
  )
    return 'BLOCKED';
  return 'PASS';
}

export function verifyEvidence(report, expected) {
  if (summarize(report) !== 'PASS') return summarize(report);
  if (
    !Array.isArray(report.source) ||
    !Array.isArray(expected?.source) ||
    !expected.source.length
  )
    return 'HISTORICAL';
  const actual = new Map(report.source.map((e) => [e.path, e.sha256]));
  if (expected.source.some((e) => actual.get(e.path) !== e.sha256))
    return 'HISTORICAL';
  for (const key of ['runId', 'schemaVersion', 'scope'])
    if (expected[key] !== undefined && report[key] !== expected[key])
      return 'HISTORICAL';
  return 'PASS';
}
// The legacy gates share a historical output folder. A scoped child-process preload
// redirects only that folder into this run; test code and assertions stay unchanged.
if (process.env.PFC_REMEDIATION_EVIDENCE === '46') {
  const fs = await import('node:fs');
  const promises = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { syncBuiltinESMExports } = await import('node:module');
  const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const old = path.join(
    repo,
    'docs/quality-gate/reports/local-use-baseline-20260913/legacy',
  );
  const attempt = process.env.PFC_REMEDIATION_LEGACY_ATTEMPT;
  if (attempt && !/^\d{13}-[a-z0-9-]+$/.test(attempt))
    throw Error('LEGACY_ATTEMPT_INVALID');
  const target = path.join(
    repo,
    'docs/quality-gate/reports/ai-tools-remediation-20260916/CODEx_TEST_AI_FIX_20260916_2467aece-52f1-4f7c-b1de-844b759e1b1a/legacy',
    attempt || '',
  );
  const mapped = (value) => {
    if (typeof value !== 'string') return value;
    const full = path.resolve(value),
      rel = path.relative(old, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return value;
    return path.join(target, rel);
  };
  for (const object of [fs.default, promises.default])
    for (const name of [
      'mkdir',
      'mkdirSync',
      'writeFile',
      'writeFileSync',
      'readFile',
      'readFileSync',
      'stat',
      'statSync',
      'lstat',
      'lstatSync',
      'existsSync',
      'readdir',
      'readdirSync',
      'rm',
      'rmSync',
      'unlink',
      'unlinkSync',
      'open',
      'openSync',
    ]) {
      if (typeof object[name] !== 'function') continue;
      const original = object[name];
      object[name] = function (value, ...args) {
        return original.call(this, mapped(value), ...args);
      };
    }
  for (const object of [fs.default, promises.default])
    for (const name of ['copyFile', 'copyFileSync', 'rename', 'renameSync']) {
      if (typeof object[name] !== 'function') continue;
      const original = object[name];
      object[name] = function (from, to, ...args) {
        return original.call(this, mapped(from), mapped(to), ...args);
      };
    }
  syncBuiltinESMExports();
}
