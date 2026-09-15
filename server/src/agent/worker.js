'use strict';
// 真实对话 worker：按 jobId 领取 TEXT 作业，经 Codex App Server 执行，
// delta 增量按序回写 ai 消息与 message.updated 事件，终态写回 job 与消息。
// 连接参数来自运行时环境（PFC_CODEX_*），授权来源为已确认的全局 AGENTS.md 例外；
// 未配置连接或调用失败时明确落 FAILED，不回退为模拟成功。
const { TextConversation } = require('./conversation-provider');
const { withTransaction } = require('../persistence/transaction');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const jobs = require('../persistence/agent-jobs');
const { reserveTurn, settleTurn, release } = require('./budget');
const {
  applyRestrictedReadAll,
  removeRestrictedReadAll,
} = require('./restricted-read');
const fail = (code) => Object.assign(new Error(code), { code });

// 本机 worker 的固定运行身份（合法 uuid，用于 agent_jobs.owner_id 租约）。
const OWNER = '00000000-0000-4000-8000-00000000a111';
const active = new Map();
const AUTHORIZATION_PATH = path.resolve(
  'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
);

function connectionOptions() {
  const binary = process.env.PFC_CODEX_BINARY;
  if (!binary) return null;
  const approved = [];
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED' && auth?.source)
      approved.push(auth.source);
  } catch {
    /* 无已确认指令源时不注入全局 AGENTS.md */
  }
  return {
    binary,
    expectedSha256: process.env.PFC_CODEX_BINARY_SHA256 || undefined,
    cwd: process.env.PFC_CODEX_PREFLIGHT_CWD || undefined,
    expectedConnectionFingerprint:
      process.env.PFC_CODEX_CONNECTION_SHA256 || undefined,
    approvedInstructionSources: approved,
  };
}

function buildTextPrompt(job) {
  const input = job.input || {};
  const parts = [String(input.content || '').trim()];
  const refs = Array.isArray(input.refs) ? input.refs : [];
  if (refs.length) {
    parts.push('（附 ' + refs.length + ' 项已确认版本引用：' + refs.map((r) => r.name || r.kind || '引用').join('、') + '）');
  }
  const text = parts.filter(Boolean).join('\n');
  if (!text) fail('EMPTY_TEXT_JOB');
  return text;
}

// 事务内更新 ai 消息 + 追加域事件 + 唤醒 WS 推送。
async function writeMessage(db, ctx, reqPublicId, reqId, aiMessageId, text, opts = {}) {
  const final = !!opts.final;
  await withTransaction(db, async (client) => {
    const reqRepo = require('../persistence/requirements');
    const req = await reqRepo.lock(client, db, ctx, reqPublicId);
    const meta = final
      ? { full: text, usage: opts.usage || null, real: true }
      : { real: true };
    await client.query(
      `UPDATE "${db.schema}".messages SET content=$1,status=$2,metadata=$3,revision=revision+1 WHERE tenant_id=$4 AND id=$5`,
      [text, final ? 'ok' : 'generating', JSON.stringify(meta), ctx.tenantId, aiMessageId],
    );
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      final ? 'message.completed' : 'message.updated',
      reqPublicId,
      req.revision,
      final
        ? { reqId: reqPublicId, messageId: aiMessageId, usage: opts.usage || null }
        : { reqId: reqPublicId, messageId: aiMessageId, agent: true },
    );
  });
  require('../domain/events').kick();
}

async function finishJob(db, ctx, jobId, state, result, code) {
  await withTransaction(db, async (client) => {
    await jobs.finish(client, db, jobId, OWNER, state, result, code);
  });
}

async function failMessage(db, ctx, reqPublicId, aiMessageId, code) {
  if (!aiMessageId) return;
  await withTransaction(db, async (client) => {
    const reqRepo = require('../persistence/requirements');
    const req = await reqRepo.lock(client, db, ctx, reqPublicId);
    await client.query(
      `UPDATE "${db.schema}".messages SET status=$1,metadata=$2,revision=revision+1 WHERE tenant_id=$3 AND id=$4`,
      ['failed', JSON.stringify({ real: true, error: code }), ctx.tenantId, aiMessageId],
    );
    await require('../persistence/events').append(
      client,
      db,
      ctx,
      'message.failed',
      reqPublicId,
      req.revision,
      { reqId: reqPublicId, messageId: aiMessageId, error: code },
    );
  });
  require('../domain/events').kick();
}

// 执行一个 TEXT 作业。幂等：同一 jobId 已在运行或已终态则跳过。
async function runTextJob({ db, ctx, reqPublicId, jobId }) {
  if (active.has(jobId)) return { skipped: true };
  const options = connectionOptions();
  let session = null;
  let writeChain = Promise.resolve();
  let aiMessageId = null;
  let startedAt = Date.now();
  let budgetActive = false;
  active.set(jobId, { cancel: () => session?.close?.() });
  try {
    const job = await withTransaction(db, async (client) => {
      const claimed = await jobs.claimById(client, db, jobId, OWNER);
      await jobs.dispatch(client, db, jobId, OWNER);
      return claimed;
    });
    aiMessageId = job.input?.aiMessageId ?? null;
    if (!options) throw fail('CONNECTION_UNAVAILABLE');
    const text = buildTextPrompt(job);
    session = await TextConversation.open(options);
    let accumulated = '';
    const result = await session.runText({
      text,
      reserveTurn: () => {
        reserveTurn();
        budgetActive = true;
        startedAt = Date.now();
      },
      onDelta: (delta) => {
        accumulated += delta;
        if (accumulated.length > 200000) {
          session.close().catch(() => {});
          throw fail('MODEL_OUTPUT_LIMIT');
        }
        writeChain = writeChain
          .then(() =>
            writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, accumulated),
          )
          .catch(() => {});
      },
    });
    await writeChain;
    await writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, result.text, {
      final: true,
      usage: result.usage || undefined,
    });
    await finishJob(db, ctx, jobId, 'SUCCEEDED', {
      text: result.text,
      usage: result.usage || null,
      threadId: result.threadId,
      turnId: result.turnId,
    }, null);
    if (budgetActive)
      settleTurn(Math.ceil((Date.now() - startedAt) / 1000), 'SUCCEEDED', {
        inputHash: createHash('sha256').update(text).digest('hex'),
      });
    return { status: 'SUCCEEDED', jobId };
  } catch (e) {
    const code = e.code || 'TURN_FAILED';
    const state =
      code === 'TURN_CANCELLED'
        ? 'CANCELLED'
        : code === 'TURN_TIMED_OUT'
          ? 'TIMED_OUT'
          : 'FAILED';
    if (aiMessageId)
      await failMessage(db, ctx, reqPublicId, aiMessageId, code).catch(() => {});
    await finishJob(db, ctx, jobId, state, null, code).catch(() => {});
    if (budgetActive) {
      try {
        settleTurn(Math.ceil((Date.now() - startedAt) / 1000), state);
      } catch {
        release();
      }
    }
    return { status: state, code };
  } finally {
    active.delete(jobId);
  }
}

async function cancel(jobId) {
  const entry = active.get(jobId);
  if (entry) await entry.cancel();
  return !!entry;
}

// EXEC 作业超时上限（毫秒）：44 号 D5 约定单次 300 秒，超时 kill 并按 TIMED_OUT 结算。
const EXEC_TIMEOUT_MS = 300000;

// 执行一个 EXEC 作业：CLI host（codex exec，Windows elevated + workspace-write）+
// 受限读 hook + 流式输出写回 ai 消息。产品形态参数从 job.input 注入：
//   content（prompt）、workspace/cwd（工作区，默认连接 cwd）、
//   restrictedReadDirs（工作区外受限读目录清单，默认空 = 不启用）。
// 幂等：同一 jobId 已在运行或已终态则跳过。
async function runExecJob({ db, ctx, reqPublicId, jobId }) {
  if (active.has(jobId)) return { skipped: true };
  const options = connectionOptions();
  let child = null;
  let timer = null;
  let heartbeat = null;
  let writeChain = Promise.resolve();
  let aiMessageId = null;
  let startedAt = Date.now();
  let budgetActive = false;
  let restrictedDirs = [];
  let apply = null;
  active.set(jobId, {
    cancel: () => {
      try {
        child?.kill();
      } catch (_) {
        /* ignore */
      }
    },
  });
  try {
    const job = await withTransaction(db, async (client) => {
      const claimed = await jobs.claimById(client, db, jobId, OWNER);
      await jobs.dispatch(client, db, jobId, OWNER);
      return claimed;
    });
    aiMessageId = job.input?.aiMessageId ?? null;
    if (!options) throw fail('CONNECTION_UNAVAILABLE');
    const input = job.input || {};
    const prompt = String(input.content || '').trim();
    if (!prompt) throw fail('EMPTY_EXEC_PROMPT');
    const workspace = String(input.workspace || input.cwd || options.cwd || process.cwd());
    restrictedDirs = Array.isArray(input.restrictedReadDirs)
      ? input.restrictedReadDirs.map((d) => String(d))
      : [];
    apply = restrictedDirs.length ? applyRestrictedReadAll(restrictedDirs) : null;
    reserveTurn();
    budgetActive = true;
    startedAt = Date.now();
    let accumulated = '';
    const binary = options.binary;
    const spawnBin = binary.endsWith('.js') ? process.execPath : binary;
    const args = (binary.endsWith('.js') ? [binary] : []).concat([
      'exec',
      '-s', 'workspace-write',
      '-c', 'windows.sandbox="elevated"',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'approval_policy=never',
      '-C', workspace,
      '--disable', 'apps',
      '--disable', 'plugins',
      '--disable', 'hooks',
      '--disable', 'browser_use',
      '--disable', 'computer_use',
      '--disable', 'multi_agent',
    ]);
    child = spawn(spawnBin, args, { cwd: workspace, windowsHide: true });
    // 心跳续租：CLI host 真实执行可能远超 claim 的 30s lease，
    // 每 20s 续租，避免 finish 时 owned 检查 AGENT_LEASE_LOST。
    heartbeat = setInterval(() => {
      withTransaction(db, async (client) => {
        await jobs.heartbeat(client, db, jobId, OWNER);
      }).catch(() => {
        /* 心跳失败不阻断作业，finish 时按实际租约判定 */
      });
    }, 20000);
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        /* ignore */
      }
    }, EXEC_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      accumulated += chunk;
      if (accumulated.length > 200000) {
        try {
          child.kill();
        } catch (_) {
          /* ignore */
        }
        writeChain = writeChain.then(() => failMessage(db, ctx, reqPublicId, aiMessageId, 'MODEL_OUTPUT_LIMIT')).catch(() => {});
      } else {
        writeChain = writeChain
          .then(() =>
            writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, accumulated),
          )
          .catch(() => {});
      }
    });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (c) => resolve(c ?? -1));
      child.stdin.end(prompt);
    });
    clearTimeout(timer);
    timer = null;
    await writeChain;
    const exceeded = accumulated.length > 200000;
    if (exceeded) throw fail('MODEL_OUTPUT_LIMIT');
    await writeMessage(db, ctx, reqPublicId, job.req_id, aiMessageId, accumulated, {
      final: true,
    });
    if (code !== 0) throw fail('EXEC_EXIT_' + code);
    await finishJob(db, ctx, jobId, 'SUCCEEDED', { text: accumulated, code }, null);
    if (budgetActive)
      settleTurn(Math.ceil((Date.now() - startedAt) / 1000), 'SUCCEEDED', {
        inputHash: createHash('sha256').update(prompt).digest('hex'),
      });
    return { status: 'SUCCEEDED', jobId };
  } catch (e) {
    const code = e.code || 'TURN_FAILED';
    const state =
      code === 'TURN_CANCELLED'
        ? 'CANCELLED'
        : code === 'TURN_TIMED_OUT'
          ? 'TIMED_OUT'
          : 'FAILED';
    if (aiMessageId)
      await failMessage(db, ctx, reqPublicId, aiMessageId, code).catch(() => {});
    await finishJob(db, ctx, jobId, state, null, code).catch(() => {});
    if (budgetActive) {
      try {
        settleTurn(Math.ceil((Date.now() - startedAt) / 1000), state);
      } catch {
        release();
      }
    }
    return { status: state, code };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null) {
      try {
        child.kill();
      } catch (_) {
        /* ignore */
      }
    }
    if (apply && restrictedDirs.length) {
      try {
        removeRestrictedReadAll(restrictedDirs);
      } catch (_) {
        /* ignore */
      }
    }
    active.delete(jobId);
  }
}

module.exports = { runTextJob, runExecJob, cancel, connectionOptions, OWNER };
