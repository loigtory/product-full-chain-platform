import fs from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const execute = promisify(execFile),
  repo = resolve(import.meta.dirname, '../..');
const root = resolve(
  repo,
  'docs/quality-gate/reports/local-use-baseline-20260913',
);
const a = JSON.parse(
  fs.readFileSync(resolve(root, 'authorization-20260913.json'), 'utf8'),
);
if (
  a.status !== 'CONFIRMED' ||
  a.gateCommands.length !== 35 ||
  process.argv.length !== 2
)
  throw Error('GATE_AUTHORIZATION_INVALID');
const supplementFile = resolve(
  root,
  'static-gate-supplement-authorization.json',
);
const supplement = fs.existsSync(supplementFile)
  ? JSON.parse(fs.readFileSync(supplementFile, 'utf8'))
  : null;
if (
  supplement &&
  (supplement.status !== 'CONFIRMED' ||
    JSON.stringify(supplement.scope) !==
      JSON.stringify(['output/pfc-workbench-prototype/verify-static.mjs']))
)
  throw Error('GATE_SUPPLEMENT_INVALID');
const sourceScope = [...a.scope, ...(supplement?.scope || [])];
const hash = (p) =>
  createHash('sha256')
    .update(fs.readFileSync(resolve(repo, p)))
    .digest('hex');
const started = Date.now(),
  sourceHashes = Object.fromEntries(sourceScope.map((p) => [p, hash(p)]));
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  authorization: '40/41 and authorization-20260913.json',
  data: 'deterministic synthetic; exact7schemas; no business/external writes',
  sourceHashes,
  gates: [],
};
const outputFile = resolve(root, 'gates-' + started + '.json');
for (const command of a.gateCommands) {
  const [node, file] = command.split(' ');
  if (node !== 'node' || !a.scope.includes(file))
    throw Error('GATE_COMMAND_INVALID');
  const begin = Date.now();
  let result;
  try {
    const run = await execute(process.execPath, [file], {
      cwd: repo,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([k]) => !/^PFC_|^PG|^DATABASE_URL$|^JWT_SECRET$|^PORT$/.test(k),
          ),
        ),
        PFC_M2C_EVIDENCE_DIR:
          'docs/quality-gate/reports/local-use-baseline-20260913/domain',
        PFC_FLOW_EVIDENCE_DIR:
          'docs/quality-gate/reports/local-use-baseline-20260913/flow',
      },
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 16 * 1048576,
    });
    result = { command, exitCode: 0, stdout: run.stdout, stderr: run.stderr };
  } catch (e) {
    result = {
      command,
      exitCode: typeof e.code === 'number' ? e.code : null,
      error: e.killed ? 'TIMEOUT' : 'GATE_FAILED',
      stdout: e.stdout || '',
      stderr: e.stderr || '',
    };
  }
  result.elapsedMs = Date.now() - begin;
  result.status = result.exitCode === 0 ? 'PASS' : 'FAIL';
  // Legacy gates use synthetic payloads. Strip accidental bearer/JWT/connection strings from raw evidence.
  for (const key of ['stdout', 'stderr'])
    result[key] = result[key]
      .replace(/postgres(?:ql)?:\/\/\S+/g, '[connection redacted]')
      .replace(/Bearer\s+\S+/g, 'Bearer [redacted]')
      .replace(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        '[synthetic JWT redacted]',
      );
  report.gates.push(result);
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      command,
      status: result.status,
      elapsedMs: result.elapsedMs,
    }),
  );
  if (result.status !== 'PASS') break;
}
report.sourceUnchanged = sourceScope.every((p) => sourceHashes[p] === hash(p));
report.elapsedMs = Date.now() - started;
report.status =
  report.gates.length === 35 &&
  report.gates.every((g) => g.status === 'PASS') &&
  report.sourceUnchanged
    ? 'PASS'
    : 'FAIL';
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status: report.status,
    gates: report.gates.length,
    outputFile,
    sourceUnchanged: report.sourceUnchanged,
  }),
);
if (report.status !== 'PASS') process.exitCode = 1;
