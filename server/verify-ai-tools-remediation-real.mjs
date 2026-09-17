import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  databaseFixture,
  profileFixture,
  repoRoot,
  workRoot,
  reportFor,
  scenario,
  saveReport,
  hash,
} from './test-data/ai-tools-remediation-fixture.mjs';
const require = createRequire(import.meta.url);
const report = reportFor(
  '46 installed Codex text protocol checks; EXEC remains blocked until every tool is constrained before execution',
);
if (
  !process.argv.includes('--real') &&
  !process.argv.includes('--preflight') &&
  !process.argv.includes('--http')
) {
  console.log(
    JSON.stringify({
      status: 'PLAN_ONLY',
      maxAdditionalTurns: 8,
      syntheticOnly: true,
    }),
  );
  process.exit(0);
}
const auth = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
    ),
  ),
);
const cwd = path.join(workRoot, 'preflight');
fs.mkdirSync(cwd, { recursive: true });
const options = {
  binary: path.join(
    process.env.APPDATA,
    'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  ),
  expectedSha256:
    'be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde',
  expectedConnectionFingerprint:
    'b585d723d61d18a815b77a2d81627cd71038d1f8cf7f4446f56e48eba4937292',
  cwd,
  approvedInstructionSources: [auth.source],
  enabledSkills: [],
};
let ready = false;
await scenario(
  report,
  'Pinned binary, current approved global instructions and non-generating protocol preflight',
  async () => {
    assert.equal(auth.status, 'USER_CONFIRMED');
    const bytes = fs.readFileSync(auth.source.path);
    assert.equal(bytes.length, auth.source.bytes);
    assert.equal(hash(bytes), auth.source.sha256);
    const { preflight } = await import('./src/agent/protocol.mjs');
    const result = await preflight(options);
    assert.equal(result.status, 'READ_ONLY_PRECHECK_READY');
    assert.equal(result.childExited, true);
    ready = true;
    return {
      status: result.status,
      childExited: result.childExited,
      connectionFingerprint: result.connectionFingerprint,
      process: result.process,
      sourceHash: auth.source.sha256,
    };
  },
);
const budgetState = require('./src/agent/budget').snapshot();
if (process.argv.includes('--real') && budgetState.turns > 0)
  report.tests.push({
    name: 'Full real scenario replay',
    status: 'BLOCKED',
    code: 'REAL_SCENARIO_ALREADY_STARTED',
    note: 'The single authorized concurrency pair cannot be repeated; use a separately bounded serial HTTP verification.',
  });
if (process.argv.includes('--real') && ready && budgetState.turns === 0) {
  const { TextConversation } = require('./src/agent/conversation-provider'),
    budget = require('./src/agent/budget');
  const one = async (label, cancel = false) => {
    let session,
      reservation,
      start,
      result,
      timer,
      outcome = 'UNKNOWN';
    try {
      session = await TextConversation.open(options);
      const text = cancel
        ? 'CODEx_TEST_取消情形：从1开始逐行写300个合成提醒规则，不使用任何工具。'
        : 'CODEx_TEST_合成积分提醒：到期前7天提醒且只提醒一次。只回答“提前7天，最多1次”。不使用任何工具。';
      try {
        result = await session.runText({
          text,
          reserveTurn: async () => {
            reservation = await budget.reserveTurn();
            start = Date.now();
            report.modelCalls++;
            if (cancel)
              timer = setTimeout(() => {
                void session.close();
              }, 100);
          },
        });
        outcome = 'SUCCEEDED';
      } catch (e) {
        outcome =
          e.code === 'TURN_CANCELLED'
            ? 'CANCELLED'
            : e.code === 'TURN_TIMED_OUT'
              ? 'TIMED_OUT'
              : 'FAILED';
        if (!cancel || outcome !== 'CANCELLED') throw e;
      } finally {
        clearTimeout(timer);
      }
      const exit = await session.close();
      assert.equal(exit.childExited, true);
      if (cancel) assert.equal(outcome, 'CANCELLED');
      else assert.match(result.text, /7/);
      return {
        label,
        outcome,
        attemptId: reservation?.attemptId,
        childExited: true,
        chars: result?.text?.length || 0,
      };
    } finally {
      clearTimeout(timer);
      const exit = await session?.close();
      if (session && exit?.childExited !== true) outcome = 'UNKNOWN';
      if (reservation)
        await budget.settleTurn(
          Math.ceil((Date.now() - start) / 1000),
          outcome,
          {},
          reservation.attemptId,
        );
    }
  };
  await scenario(
    report,
    'Real synthetic TEXT completes and the owned process exits',
    () => one('normal'),
  );
  if (!report.errors.length)
    await scenario(
      report,
      'Real TEXT cancellation confirms process exit and counts the attempt',
      () => one('cancel', true),
    );
  if (!report.errors.length)
    await scenario(
      report,
      'One authorized pair of real TEXT jobs settles distinct attempts',
      async () => {
        const results = await Promise.allSettled([
          one('parallel-a'),
          one('parallel-b'),
        ]);
        assert.ok(results.every((x) => x.status === 'fulfilled'));
        assert.notEqual(results[0].value.attemptId, results[1].value.attemptId);
        return results.map((x) => x.value);
      },
    );
  report.budget = budget.snapshot();
  report.tests.push({
    name: 'Actual EXEC approval/deny/readonly/out-of-scope/rollback and persisted HTTP worker integration',
    status: 'BLOCKED',
    code: 'EXEC_APPROVAL_COVERAGE_UNVERIFIED',
    note: 'Text protocol checks alone do not close this gate',
  });
}
if (process.argv.includes('--http') && ready) {
  let f,
    p,
    child,
    exit,
    ended = false;
  const budget = require('./src/agent/budget'),
    before = budget.snapshot();
  try {
    assert.ok(
      before.remaining >= 2 && before.unresolved === 0,
      'Two bounded serial turns must remain',
    );
    f = await databaseFixture('api');
    await require('./src/persistence/migrations').migrate(f.db);
    const seed = await f.seed();
    p = await profileFixture(f, seed, 'api');
    const { spawn } = await import('node:child_process'),
      { once } = await import('node:events'),
      { randomUUID } = await import('node:crypto');
    child = spawn(process.execPath, ['server/src/index.js'], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...require('./src/local/ops-config').environment(p.profile),
        PFC_CODEX_BINARY: options.binary,
        PFC_CODEX_BINARY_SHA256: options.expectedSha256,
        PFC_CODEX_CONNECTION_SHA256: options.expectedConnectionFingerprint,
        PFC_CODEX_PREFLIGHT_CWD: options.cwd,
      },
    });
    exit = once(child, 'exit').then(() => {
      ended = true;
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    const base = 'http://127.0.0.1:5203',
      until = Date.now() + 45000;
    let health = false;
    while (!ended && Date.now() < until) {
      try {
        const r = await fetch(base + '/api/health', {
          signal: AbortSignal.timeout(1000),
        });
        health = r.ok;
        if (health) break;
      } catch {
        /*Startup is not ready yet.*/
      }
      await new Promise((ok) => setTimeout(ok, 100));
    }
    assert.equal(health, true, 'Owned HTTP service readiness');
    const login = await fetch(base + '/api/auth/local-session', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: p.key }),
    });
    assert.equal(login.status, 200);
    const headers = {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: login.headers.get('set-cookie').split(';')[0],
    };
    const sql = async (query, args) =>
      (await f.db.pool.query(query, args)).rows;
    const revision = async () =>
      (
        await sql(
          'SELECT revision FROM "' + f.db.schema + '".reqs WHERE id=$1',
          [seed.req.id],
        )
      )[0].revision;
    const readJob = async (id) =>
      (
        await sql(
          'SELECT id,state,dispatched_at,error_code,input FROM "' +
            f.db.schema +
            '".agent_jobs WHERE id=$1',
          [id],
        )
      )[0];
    const poll = async (id, predicate, timeout = 320000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const row = await readJob(id);
        if (predicate(row)) return row;
        await new Promise((ok) => setTimeout(ok, 50));
      }
      throw Error('REAL_HTTP_JOB_TIMEOUT');
    };
    for (const cancel of [false, true]) {
      await scenario(
        report,
        cancel
          ? 'Actual HTTP/PG/worker real TEXT cancellation'
          : 'Actual HTTP/PG/worker real TEXT completion',
        async () => {
          const request = {
            commandId: randomUUID(),
            expectedRevision: await revision(),
            stage: 'idea',
            mode: 'real',
            content: cancel
              ? 'CODEx_TEST_取消验证：逐行列出300个合成规则，不使用工具。'
              : 'CODEx_TEST_合成积分提醒：提前7天提醒且最多1次。只回答提前7天，最多1次。不使用工具。',
          };
          const response = await fetch(
            base + '/api/reqs/' + seed.req.public_id + '/messages',
            {
              method: 'POST',
              headers,
              body: JSON.stringify(request),
              signal: AbortSignal.timeout(320000),
            },
          );
          assert.equal(response.status, 201);
          const body = await response.json();
          assert.ok(body.jobId);
          if (cancel) {
            const dispatched = await poll(
              body.jobId,
              (row) =>
                row.dispatched_at || !['QUEUED', 'RUNNING'].includes(row.state),
              60000,
            );
            assert.ok(
              dispatched.dispatched_at,
              'Cancellation must exercise a dispatched real attempt',
            );
            const stopped = await fetch(
              base +
                '/api/reqs/' +
                seed.req.public_id +
                '/messages/' +
                body.reply.id +
                '/stop',
              {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  commandId: randomUUID(),
                  expectedRevision: await revision(),
                }),
                signal: AbortSignal.timeout(20000),
              },
            );
            assert.equal(stopped.status, 200);
            assert.equal((await stopped.json()).cancellation.confirmed, true);
          }
          const row = await poll(
            body.jobId,
            (x) => !['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(x.state),
          );
          assert.equal(
            row.state,
            cancel ? 'CANCELLED' : 'SUCCEEDED',
            row.error_code || 'job terminal',
          );
          const message = (
            await sql(
              'SELECT status,content,metadata FROM "' +
                f.db.schema +
                '".messages WHERE id=$1',
              [row.input.aiMessageId],
            )
          )[0];
          assert.equal(message.status, cancel ? 'stopped' : 'ok');
          if (!cancel) assert.match(message.content, /7/);
          return {
            jobId: row.id,
            jobState: row.state,
            messageStatus: message.status,
            contextHash: row.input.contextHash,
            sourceCount: row.input.context?.blocks?.length ?? 0,
          };
        },
      );
      if (report.errors.length) break;
    }
  } catch (e) {
    report.errors.push({ error: e.code || e.message });
  } finally {
    if (child && !ended) {
      if (p) {
        await require('./src/local/lifecycle').stop(p.profile);
      } else child.kill();
      await exit;
    }
    if (p) await p.cleanup();
    if (f) report.databaseCleanup = await f.cleanup();
    report.budget = budget.snapshot();
    report.modelCalls = report.budget.turns - before.turns;
    assert.ok(
      report.modelCalls <= 2,
      'Only two serial calls authorized by this verifier',
    );
  }
  report.tests.push({
    name: 'Actual EXEC pre-execution enforcement',
    status: 'BLOCKED',
    code: 'EXEC_APPROVAL_COVERAGE_UNVERIFIED',
  });
}
report.cleanup = {
  status: 'PASS',
  retained: [path.relative(repoRoot, cwd)],
  note: 'Owned preflight/schema inspection files await final cleanup; HTTP mode starts and closes its owned 5203 service and synthetic schema, preflight mode starts no API service',
};
saveReport(
  report,
  process.argv.includes('--http')
    ? 'real-http'
    : process.argv.includes('--real')
      ? 'real'
      : 'preflight',
);
