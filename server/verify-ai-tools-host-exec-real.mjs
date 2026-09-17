import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openProtocol } from './src/agent/protocol.mjs';
import {
  reportFor,
  scenario,
  saveReport,
  workspaceFixture,
  hostJobFixture,
  repoRoot,
  blocked,
  hash,
} from './test-data/ai-tools-host-exec-fixture.mjs';
const require = createRequire(import.meta.url),
  report = reportFor('host-real');
const f = workspaceFixture('real-' + Date.now());
const source = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
    ),
  ),
).source;
const options = {
  binary: path.join(
    process.env.APPDATA,
    'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  ),
  expectedSha256:
    'be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde',
  expectedConnectionFingerprint:
    'b585d723d61d18a815b77a2d81627cd71038d1f8cf7f4446f56e48eba4937292',
  cwd: f.workspace,
  mode: 'host',
  approvedInstructionSources: [source],
  enabledSkills: [],
};
let ready = false;
try {
  await scenario(
    report,
    'Pinned connection and native-tool config verified without model generation',
    async () => {
      const connection = await openProtocol(options);
      try {
        assert.equal(connection.summary.instanceIsolation, 'CONFIG_VERIFIED');
        assert.ok(
          Object.values(connection.summary.textIsolation).every(
            (v) => v === true,
          ),
        );
        report.preflight = connection.summary;
        ready = true;
      } finally {
        report.preflightExit = await connection.close();
        assert.equal(report.preflightExit.childExited, true);
      }
    },
  );
  if (process.argv.includes('--real') && ready)
    await scenario(
      report,
      'Actual dynamic request matches independent item identity and exact read arguments',
      async () => {
        const {
          TextConversation,
        } = require('./src/agent/conversation-provider');
        const budget = require('./src/agent/budget').hostBudget();
        let session,
          reservation,
          start,
          status = 'FAILED';
        const calls = [],
          events = [];
        try {
          session = await TextConversation.open({
            ...options,
            onTurnEvent: (event) => {
              if (event.params?.item?.type === 'dynamicToolCall')
                events.push({ method: event.method, params: event.params });
            },
            onToolCall: async (bound) => {
              calls.push({
                requestId: bound.requestId,
                callId: bound.callId,
                itemId: bound.itemId,
                threadId: bound.threadId,
                turnId: bound.turnId,
                tool: bound.tool,
                argumentsHash: hash(JSON.stringify(bound.arguments)),
              });
              if (
                bound.tool !== 'pfc_read_file' ||
                JSON.stringify(bound.arguments) !==
                  JSON.stringify({ path: 'example.txt' })
              )
                return {
                  success: false,
                  contentItems: [
                    { type: 'inputText', text: 'PFC_PROBE_READ_ONLY' },
                  ],
                };
              return {
                success: true,
                contentItems: [
                  {
                    type: 'inputText',
                    text: fs.readFileSync(
                      path.join(f.workspace, 'example.txt'),
                      'utf8',
                    ),
                  },
                ],
              };
            },
          });
          const result = await session.runText({
            text: 'Authorized synthetic protocol check, already planned and approved. Use pfc_read_file exactly once with path example.txt. Do not use any other tool. Then quote the returned synthetic baseline in one short sentence.',
            reserveTurn: async () => {
              reservation = await budget.reserveTurn();
              start = Date.now();
              report.modelCalls++;
            },
          });
          report.dynamic = {
            calls,
            events,
            resultText: result.text,
            readback: session.readback,
          };
          assert.equal(calls.length, 1);
          assert.equal(calls[0].tool, 'pfc_read_file');
          assert.equal(calls[0].callId, calls[0].itemId);
          assert.match(result.text, /synthetic baseline/);
          status = 'SUCCEEDED';
          report.dynamic = {
            calls,
            events,
            resultHash: hash(result.text),
            readback: session.readback,
          };
        } finally {
          report.dynamic ??= { calls, events };
          const exit = await session?.close();
          report.modelExit = exit;
          if (session && exit?.childExited !== true) status = 'UNKNOWN';
          if (reservation)
            await budget.settleTurn(
              (Date.now() - start) / 1000,
              status,
              {},
              reservation.attemptId,
            );
          report.budget = budget.snapshot();
        }
      },
    );
  if (process.argv.includes('--real') && ready)
    for (const cancel of [false, true])
      await scenario(
        report,
        cancel
          ? 'Actual cancellation persists before tool effect and awaits process exit'
          : 'Actual model file write passes live PG authorization and durable evidence',
        async () => {
          process.env.PFC_HOST_EXEC_TEST_PACKAGE = '48';
          const { databaseFixture } =
            await import('./test-data/ai-tools-remediation-fixture.mjs');
          const fixture = await databaseFixture('api');
          const {
              withTransaction: tx,
            } = require('./src/persistence/transaction'),
            jobs = require('./src/persistence/agent-jobs');
          let x,
            session,
            heartbeat,
            reservation,
            started,
            status = 'FAILED';
          const budget = require('./src/agent/budget').hostBudget();
          try {
            await require('./src/persistence/migrations').migrate(fixture.db);
            x = await hostJobFixture(
              fixture,
              cancel ? 'real-cancel' : 'real-write',
              false,
            );
            heartbeat = setInterval(
              () =>
                tx(fixture.db, (c) =>
                  jobs.heartbeat(c, fixture.db, x.job.id, x.ownerId),
                ).catch(() => x.control.stop('AGENT_LEASE_LOST')),
              10000,
            );
            const calls = [];
            session =
              await require('./src/agent/conversation-provider').TextConversation.open(
                {
                  ...options,
                  cwd: x.wf.workspace,
                  onToolCall: async (bound) => {
                    calls.push({
                      tool: bound.tool,
                      callId: bound.callId,
                      itemId: bound.itemId,
                    });
                    if (cancel) {
                      await tx(fixture.db, (c) =>
                        jobs.requestCancel(
                          c,
                          fixture.db,
                          x.ctx,
                          x.req.id,
                          x.job.id,
                        ),
                      );
                      void x.control.stop('TURN_CANCELLED');
                    }
                    return x.dispatch(bound);
                  },
                },
              );
            x.control.attach(session);
            const completion = session.runText({
              text: 'This synthetic file task and its plan are already approved by the Owner. Read example.txt with pfc_read_file. Then use pfc_write_file on example.txt with the exact returned sha256 as expectedHash and content "synthetic host write\\n". Do not run any commands or access other files. Report only what actually happened.',
              reserveTurn: async () => {
                reservation = await budget.reserveTurn();
                started = Date.now();
                report.modelCalls++;
                await tx(fixture.db, (c) =>
                  jobs.dispatch(c, fixture.db, x.job.id, x.ownerId),
                );
              },
            });
            if (cancel)
              await assert.rejects(completion, { code: 'TURN_CANCELLED' });
            else await completion;
            const exit = await session.close();
            assert.equal(exit.childExited, true);
            const rows = (
              await fixture.db.pool.query(
                `SELECT state,evidence FROM "${fixture.db.schema}".tool_executions WHERE job_id=$1 ORDER BY created_at`,
                [x.job.id],
              )
            ).rows;
            const actual = fs.readFileSync(
              path.join(x.wf.workspace, 'example.txt'),
              'utf8',
            );
            if (cancel) {
              assert.equal(actual, 'synthetic baseline\n');
              assert.equal(rows.length, 0);
              assert.equal(x.control.exitConfirmed, true);
            } else {
              assert.ok(calls.some((c) => c.tool === 'pfc_write_file'));
              assert.match(actual, /^synthetic host write(?:\n|\\n)$/);
              assert.ok(rows.length >= 2);
              assert.equal(rows.at(-1).evidence.sha256, hash(actual));
              assert.ok(rows.every((r) => r.state === 'SUCCEEDED'));
            }
            status = cancel ? 'CANCELLED' : 'SUCCEEDED';
            await tx(fixture.db, (c) =>
              jobs.finish(
                c,
                fixture.db,
                x.job.id,
                x.ownerId,
                status,
                { synthetic: true },
                null,
              ),
            );
            report[cancel ? 'actualCancel' : 'actualWrite'] = {
              calls,
              fileHash: hash(actual),
              toolRows: rows.length,
              jobId: x.job.id,
              process: exit.process,
            };
          } finally {
            clearInterval(heartbeat);
            const exit = await session?.close();
            if (session && exit?.childExited !== true) status = 'UNKNOWN';
            if (reservation)
              await budget.settleTurn(
                (Date.now() - started) / 1000,
                status,
                {},
                reservation.attemptId,
              );
            report.budget = budget.snapshot();
            x?.cleanup();
            (report.databaseCleanup ??= []).push(await fixture.cleanup());
          }
        },
      );
  await scenario(report, 'Windows command isolation mechanism', () => {
    throw blocked(
      'HOST_COMMAND_SANDBOX_UNVERIFIED: installed 0.154.0 policy lacks a read allowlist; setup/ACL changes are excluded. No command was dispatched.',
    );
  });
} finally {
  f.cleanup();
  report.cleanup = {
    workspaceRemoved: !fs.existsSync(f.workspace),
    helpers: 'Closed in finally',
  };
}
saveReport(report, 'real');
