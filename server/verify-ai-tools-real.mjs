import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { TextConversation } from './src/agent/conversation-provider.js';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  scope: 'A0 real text probe only; full AI/tool acceptance pending',
  modelTurns: 0,
};
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const privateRoot = path.resolve(
  '.local/ai-tools-integration-20260914/preflight',
);
const ledgerPath = path.join(privateRoot, 'configs/model-budget.json');
const prompt =
  'CODEx_TEST_AI_TOOLS_20260914。只依据合成材料MAT-1-v1：会员积分到期前7天发送一次站内提醒；同一会员同一到期日只能发送一次。输出JSON，字段sourceId="MAT-1-v1"，daysBeforeExpiry（数字），channel（英文in_app），deduplicationFields（英文memberId和expiryDate数组）。不要调用工具，不添加其他字段。';
let session, lock, reservation, startedAt;
try {
  const contextAuthorization = JSON.parse(
    readFileSync(
      `${root}/context-exception-confirmation-20260914.json`,
      'utf8',
    ),
  );
  assert.equal(contextAuthorization.status, 'USER_CONFIRMED');
  assert.equal(
    contextAuthorization.connectionFingerprint,
    process.env.PFC_CODEX_CONNECTION_SHA256,
  );
  session = await TextConversation.open({
    binary: process.env.PFC_CODEX_BINARY,
    expectedSha256: process.env.PFC_CODEX_BINARY_SHA256,
    cwd: process.env.PFC_CODEX_PREFLIGHT_CWD,
    expectedConnectionFingerprint: process.env.PFC_CODEX_CONNECTION_SHA256,
    approvedInstructionSources: [contextAuthorization.source],
  });
  report.context = session.readback;
  report.status = 'TEXT_SESSION_READY';
  if (process.argv.includes('--generate')) {
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    lock = openSync(ledgerPath + '.lock', 'wx');
    let budget;
    try {
      budget = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      budget = {
        package: '44-ai-tools-integration-20260914',
        turns: 0,
        reservedSeconds: 0,
        attempts: [],
      };
    }
    assert.equal(budget.package, '44-ai-tools-integration-20260914');
    assert.ok(
      Number.isSafeInteger(budget.turns) &&
        budget.turns >= 0 &&
        budget.turns < 20,
    );
    assert.ok(
      Number.isFinite(budget.reservedSeconds) &&
        budget.reservedSeconds >= 0 &&
        budget.reservedSeconds + 300 <= 3600,
    );
    const result = await session.runText({
      text: prompt,
      reserveTurn: () => {
        reservation = {
          at: new Date().toISOString(),
          inputHash: createHash('sha256').update(prompt).digest('hex'),
          status: 'DISPATCHING',
          reservedSeconds: 300,
        };
        budget.turns++;
        budget.reservedSeconds += 300;
        budget.attempts.push(reservation);
        writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
        startedAt = Date.now();
        report.modelTurns = 1;
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceId: { type: 'string' },
          daysBeforeExpiry: { type: 'number' },
          channel: { type: 'string' },
          deduplicationFields: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'sourceId',
          'daysBeforeExpiry',
          'channel',
          'deduplicationFields',
        ],
      },
    });
    report.outputHash = createHash('sha256').update(result.text).digest('hex');
    report.usage = result.usage;
    const content = JSON.parse(result.text);
    assert.equal(content.sourceId, 'MAT-1-v1');
    assert.equal(content.daysBeforeExpiry, 7);
    assert.equal(content.channel, 'in_app');
    assert.deepEqual([...content.deduplicationFields].sort(), [
      'expiryDate',
      'memberId',
    ]);
    report.assertions = 4;
    report.status = 'REAL_TEXT_PASS';
    reservation.status = 'SUCCEEDED';
    reservation.actualSeconds = Math.ceil((Date.now() - startedAt) / 1000);
    budget.reservedSeconds -= 300 - reservation.actualSeconds;
    writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + '\n');
    report.budget = {
      turns: budget.turns,
      accountedSeconds: budget.reservedSeconds,
    };
  }
} catch (e) {
  report.status = 'FAIL';
  report.error = { code: e.code ?? 'ASSERTION_FAILED' };
  report.context ??= e.readback;
  report.connection ??= e.connection ?? e.preflight;
  process.exitCode = 1;
} finally {
  if (session) report.connection = await session.close();
  if (lock !== undefined) {
    closeSync(lock);
    unlinkSync(ledgerPath + '.lock');
  }
  report.elapsedSeconds = startedAt
    ? Math.ceil((Date.now() - startedAt) / 1000)
    : 0;
  mkdirSync(root, { recursive: true });
  const file = `${root}/real-text-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      modelTurns: report.modelTurns,
      file,
      error: report.error,
    }),
  );
}
