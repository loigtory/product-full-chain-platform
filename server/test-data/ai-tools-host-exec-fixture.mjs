import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const runId =
  'CODEx_TEST_AI_HOST_20260917_b601306c-a342-4a04-b27a-82080b615dd9';
export const evidenceRoot = path.join(
  repoRoot,
  'docs/quality-gate/reports/ai-tools-host-exec-20260917',
  runId,
);
export const workRoot = path.join(
  repoRoot,
  '.local/ai-tools-host-exec-20260917',
  runId,
);
export const hash = (v) => createHash('sha256').update(v).digest('hex');
export const authorization = JSON.parse(
  fs.readFileSync(path.join(evidenceRoot, 'authorization.json')),
);
export function reportFor(scope) {
  return {
    at: new Date().toISOString(),
    runId,
    scope,
    tests: [],
    errors: [],
    modelCalls: 0,
    data: 'Deterministic owned synthetic fixtures. Owner is this run; no customer data.',
    acceptance: 'PENDING',
    cleanup: 'No retained test helpers',
  };
}
export async function scenario(report, name, fn) {
  try {
    report.tests.push({ name, status: 'PASS', details: await fn() });
  } catch (e) {
    const row = {
      name,
      status: e.blocked ? 'BLOCKED' : 'FAIL',
      error: String(e.code || e.message).slice(0, 500),
      ...(e.code === 'ERR_ASSERTION'
        ? { assertion: e.message.slice(0, 1200) }
        : {}),
    };
    report.tests.push(row);
    if (!e.blocked) report.errors.push(row);
  }
}
export const blocked = (code) =>
  Object.assign(new Error(code), { code, blocked: true });
export function saveReport(report, prefix) {
  report.status = report.tests.some((t) => t.status === 'FAIL')
    ? 'FAIL'
    : report.tests.some((t) => t.status === 'BLOCKED')
      ? 'BLOCKED'
      : 'PASS';
  report.source = authorization.entries
    .filter((e) => fs.existsSync(path.join(repoRoot, e.path)))
    .map((e) => ({
      path: e.path,
      sha256: hash(fs.readFileSync(path.join(repoRoot, e.path))),
    }));
  const file = path.join(evidenceRoot, `${prefix}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      failures: report.errors,
      file: path.relative(repoRoot, file),
    }),
  );
  process.exitCode =
    report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
  return file;
}
export function workspaceFixture(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('FIXTURE_NAME_INVALID');
  const workspace = path.join(workRoot, 'workspace', name);
  if (fs.existsSync(workspace)) throw Error('FIXTURE_ALREADY_EXISTS');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'example.txt'), 'synthetic baseline\n');
  return {
    workspace,
    cleanup() {
      fs.rmSync(workspace, { recursive: true });
    },
  };
}

export async function hostJobFixture(fixture, name = 'job', dispatched = true) {
  const db = fixture.db,
    { ctx, req } = await fixture.seed();
  const { withTransaction: tx } = require('../src/persistence/transaction');
  const jobs = require('../src/persistence/agent-jobs'),
    ec = require('../src/agent/exec-control');
  await tx(db, (c) =>
    c.query(`UPDATE "${db.schema}".reqs SET stage='dev' WHERE id=$1`, [req.id]),
  );
  req.stage = 'dev';
  const wf = workspaceFixture(name + '-' + randomUUID());
  try {
    const snapshot = await tx(db, (c) =>
      require('../src/agent/context-service').stageSnapshot(
        c,
        db,
        ctx,
        req,
        'dev',
      ),
    );
    const plan = ec.freezeForActor(
      {
        workspace: wf.workspace,
        control: {
          confirmed: true,
          mode: 'strict',
          allowedFiles: ['example.txt', 'new.txt'],
          forbidden: [],
          validUntil: new Date(Date.now() + 120000).toISOString(),
          baselineHash: ec.baselineHash(ec.scanWorkspace(wf.workspace)),
        },
      },
      ctx,
      req,
      snapshot.hash,
    );
    const ownerId = randomUUID(),
      job = await tx(db, async (c) => {
        const j = await jobs.enqueue(c, db, ctx, req, {
          kind: 'EXECUTE',
          commandId: randomUUID(),
          inputHash: hash('synthetic'),
          input: {
            stage: 'dev',
            workspace: wf.workspace,
            contextHash: snapshot.hash,
            control: plan,
          },
        });
        await jobs.claimById(c, db, j.id, ownerId);
        if (dispatched) await jobs.dispatch(c, db, j.id, ownerId);
        return j;
      });
    fixture.createdIds.push(job.id);
    const scope = require('../src/agent/scope-policy').createScope(
      wf.workspace,
      plan,
    );
    const control = require('../src/agent/job-control').createControl();
    const dispatch =
      require('../src/agent/approval-service').createHostDispatcher({
        db,
        ctx,
        reqPublicId: req.public_id,
        jobId: job.id,
        ownerId,
        scope,
        control,
      });
    return {
      db,
      ctx,
      req,
      job,
      wf,
      scope,
      control,
      dispatch,
      ownerId,
      cleanup: wf.cleanup,
    };
  } catch (e) {
    wf.cleanup();
    throw e;
  }
}
