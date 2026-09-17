'use strict';
const { S, seedFromState, pushAudit } = require('./store');
const sm = require('./state-machine');
// Existing memory demonstration adapter; no PG caller may enter this block.
async function answerQuestion(id, qid, { answer }) {
  await seedFromState();
  const q = S.questions.get(qid);
  if (!q || q.reqId !== id) return { error: 'NOT_FOUND' };
  q.answer = answer;
  q.answeredBy = '陈立';
  pushAudit('陈立', '回答澄清', id + ' ' + q.q);
  return { question: q };
}

async function sendMessage(id, { content, attachments }) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const m = {
    id: 'SMSG-' + S.seq.msg,
    reqId: id,
    stage: req.stage,
    turnId: 'T-' + S.seq.msg,
    role: 'user',
    content: content || '',
    attachments: attachments || [],
    status: 'ok',
    createdAt: new Date().toISOString(),
  };
  S.seq.msg++;
  S.messages.set(m.id, m);
  return { message: m, actions: [] }; // Agent 响应动作在 M2b 接 Bridge 后回填
}

async function getMessages(id, stage, offset, limit) {
  await seedFromState();
  const all = [...S.messages.values()]
    .filter((m) => m.reqId === id && (!stage || m.stage === stage))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { items: all.slice(offset, offset + limit), total: all.length };
}
const memory = { answerQuestion, sendMessage, getMessages };
module.exports = { memory };

module.exports.answerQuestion = (...args) =>
  require('./requirement-service').answerQuestion(...args);

const runtime = require('../runtime'),
  access = require('../access'),
  repo = require('../persistence/messages'),
  reqRepo = require('../persistence/requirements');
const { withTransaction } = require('../persistence/transaction'),
  { randomUUID, createHash } = require('node:crypto'),
  { statSync } = require('node:fs');

// 真实作业输入解析：exec 工具形态（tool:'exec' + workspace + restrictedReadDirs）
// → EXECUTE 作业（经 runExecJob 在 CLI host 执行）；其余 → TEXT 作业。
// workspace 提供时须为已存在目录（不存在/非目录分别 400）。
// 独立导出以便协议级单测（零模型），执行链由 verify-ai-tools-exec-worker 真实闸覆盖。
function resolveRealJobInput(input, ids) {
  const { userMessageId, aiMessageId, content, refs, stage } = ids;
  const execTool =
    input.tool === 'exec'
      ? {
          workspace: input.workspace,
          restrictedReadDirs: input.restrictedReadDirs,
          control: input.control ?? null,
        }
      : null;
  if (execTool?.workspace) {
    let st;
    try {
      st = statSync(String(execTool.workspace));
    } catch {
      access.fail('WORKSPACE_NOT_FOUND', 400);
    }
    if (!st.isDirectory()) access.fail('WORKSPACE_NOT_DIRECTORY', 400);
  }
  const stageContext =
    require('../agent/context-service').normalizeStageContext(
      input.stageContext ?? [],
      stage,
    );
  return {
    kind: execTool ? 'EXECUTE' : 'TEXT',
    commandId: (execTool ? 'EXEC-' : 'MSG-') + userMessageId,
    inputHash: createHash('sha256')
      .update(
        JSON.stringify({
          content: content || '',
          ...(execTool
            ? {
                workspace: execTool.workspace ?? null,
                restrictedReadDirs: execTool.restrictedReadDirs ?? [],
                control: execTool.control ?? null,
              }
            : {}),
          ...(stageContext.length ? { stageContext } : {}),
        }),
      )
      .digest('hex'),
    input: {
      userMessageId,
      aiMessageId,
      content: content || '',
      refs,
      stage,
      ...(stageContext.length ? { stageContext } : {}),
      ...(execTool
        ? {
            workspace: execTool.workspace,
            restrictedReadDirs: execTool.restrictedReadDirs || [],
            control: execTool.control ?? undefined,
          }
        : {}),
    },
  };
}
module.exports.resolveRealJobInput = resolveRealJobInput;
const pending = new Map();
function schedule(db, ctx, reqPublicId, messageId) {
  if (pending.has(messageId)) return;
  const timer = setTimeout(async () => {
    pending.delete(messageId);
    try {
      const again = await withTransaction(db, async (client) => {
        const req = await reqRepo.lock(client, db, ctx, reqPublicId),
          m = await repo.find(client, db, ctx, req.id, messageId);
        if (!m || m.status !== 'generating') return false;
        const text = m.metadata.full.slice(0, m.content.length + 36),
          status = text.length === m.metadata.full.length ? 'ok' : 'generating';
        await client.query(
          'UPDATE "' +
            db.schema +
            '".messages SET content=$1,status=$2,revision=revision+1 WHERE tenant_id=$3 AND id=$4',
          [text, status, ctx.tenantId, m.id],
        );
        await require('../persistence/events').append(
          client,
          db,
          ctx,
          'message.updated',
          reqPublicId,
          req.revision,
          { reqId: reqPublicId, messageId },
        );
        return status === 'generating';
      });
      require('./events').kick();
      if (again) schedule(db, ctx, reqPublicId, messageId);
    } catch {
      /* Persisted generating status is retained; restart marks it interrupted. */
    }
  }, 80);
  pending.set(messageId, timer);
  timer.unref();
}
module.exports.sendMessage = async (id, input) => {
  const ctx = access.current(true),
    db = runtime.db();
  access.text(input.content || '', 8000);
  let cancelContext;
  const supersededJobs = [];
  const result = await require('./requirement-service').mutate(
    id,
    input,
    'message.sent',
    async (client, db, ctx, row) => {
      const stage = input.stage || row.stage;
      // The selected stage may never exceed the persisted requirement stage.
      if (
        ![
          'idea',
          'req',
          'design',
          'dev',
          'test',
          'accept',
          'release',
          'observe',
        ].includes(stage) ||
        sm.STAGES.indexOf(stage) > sm.STAGES.indexOf(row.stage)
      )
        access.fail('INVALID_STAGE', 400);
      const refs = await repo.references(client, db, ctx, row.id, [
        ...(input.refs || []),
        ...(input.attachments || []).map((a) => ({ ...a, kind: 'attachment' })),
      ]);
      if (!input.content?.trim() && !refs.length)
        access.fail('EMPTY_MESSAGE', 400);
      for (const ref of input.refs || [])
        if (ref.requirementId && ref.requirementId !== id)
          access.fail('INVALID_REFERENCE', 400);
      const parent = input.parentMessageId
        ? await repo.find(client, db, ctx, row.id, input.parentMessageId)
        : null;
      const reply = input.replyTo
        ? await repo.find(client, db, ctx, row.id, input.replyTo)
        : null;
      if (
        (input.replyTo && !reply) ||
        (input.parentMessageId && (!parent || parent.role !== 'user'))
      )
        access.fail('INVALID_MESSAGE_REFERENCE', 400);
      await client.query(
        'UPDATE "' +
          db.schema +
          '".messages SET status=$1,revision=revision+1 WHERE tenant_id=$2 AND req_id=$3 AND status=$4',
        ['stopped', ctx.tenantId, row.id, 'generating'],
      );
      if (['007', '008'].includes(db.targetVersion)) {
        const old = (
          await client.query(
            `SELECT id FROM "${db.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND state IN ('QUEUED','RUNNING','WAITING_APPROVAL') FOR UPDATE`,
            [ctx.tenantId, row.id],
          )
        ).rows;
        for (const job of old) {
          await require('../persistence/agent-jobs').requestCancel(
            client,
            db,
            ctx,
            row.id,
            job.id,
          );
          supersededJobs.push(job.id);
        }
        cancelContext = { db, ctx, reqId: row.id };
      }
      const cleanRefs = refs.map(
        ({ materialVersionId, reqVersionId, artifactVersionId, ...r }) => ({
          ...r,
          requirementId: id,
        }),
      );
      const user = await repo.create(client, db, ctx, row, {
        turnId: 'T-' + randomUUID(),
        role: 'user',
        stage,
        content: input.content || '',
        status: 'ok',
        replyTo: reply?.id,
        parentId: parent?.id,
        metadata: {
          refs: cleanRefs,
          attachments: cleanRefs.filter((r) => r.kind === 'attachment'),
          resent: !!parent,
        },
      });
      if (parent)
        await client.query(
          'UPDATE "' +
            db.schema +
            '".messages SET retry_message_id=$1,revision=revision+1 WHERE tenant_id=$2 AND id=$3',
          [user.id, ctx.tenantId, parent.id],
        );
      await repo.attach(client, db, ctx, user, refs);
      const base = require('./requirement-service').latest(
        await reqRepo.versions(client, db, ctx, row.id),
        stage,
      );
      const changes = [];
      for (const f of base?.content.fields || []) {
        const marker = '将' + f.name + '改为';
        const at = (input.content || '').indexOf(marker);
        if (at >= 0) {
          const after = input.content.slice(at + marker.length).trim();
          if (after && after !== f.value)
            changes.push({ name: f.name, before: f.value, after });
        }
      }
      const diff =
        !['test', 'accept', 'release', 'observe'].includes(stage) &&
        changes.length
          ? {
              stage,
              base: base.content.id,
              baseVersionId: base.public_id,
              fields: changes,
            }
          : null;
      const full =
        input.mode === 'real'
          ? null
          : '【模拟回复】已保存本次对话' +
            (refs.length ? '及 ' + refs.length + ' 项版本引用' : '') +
            '.' +
            (diff
              ? '已生成字段差异，请确认后采纳。'
              : '当前未接入真实模型；可继续整理材料、完善版本或发起模拟作业。');
      const ai = await repo.create(client, db, ctx, row, {
        turnId: user.turn_id,
        role: 'ai',
        stage,
        content: '',
        status: 'generating',
        replyTo: user.id,
        metadata: {
          full,
          refs: cleanRefs,
          diff,
          diffApplied: false,
          attachments: [],
          ...(input.mode === 'real' ? { real: true } : {}),
        },
      });
      await repo.attach(client, db, ctx, ai, refs);
      let realJobId = null;
      let realJobKind = null;
      if (input.mode === 'real') {
        // exec 工具形态：前端在开发阶段以 tool:'exec' + workspace 触发 EXECUTE 作业，
        // 经 runExecJob 在 CLI host（codex exec）执行并实时回写对话流。
        const context = await require('../agent/context-service').stageSnapshot(
          client,
          db,
          ctx,
          row,
          stage,
          input.contextSources ?? [],
        );
        const jobInput = resolveRealJobInput(input, {
          userMessageId: user.id,
          aiMessageId: ai.id,
          content: input.content || '',
          refs: cleanRefs,
          stage,
        });
        jobInput.input.context = context.snapshot;
        jobInput.input.contextHash = context.hash;
        if (jobInput.kind === 'EXECUTE') {
          if (stage !== 'dev' || row.stage !== 'dev' || ctx.role !== 'owner')
            access.fail('EXEC_STAGE_OR_ROLE_INVALID', 403);
          require('../agent/execution-policy').requireCapability();
          jobInput.input.control =
            require('../agent/exec-control').freezeForActor(
              jobInput.input,
              ctx,
              row,
              context.hash,
            );
        }
        jobInput.inputHash = createHash('sha256')
          .update(JSON.stringify(jobInput.input))
          .digest('hex');
        const job = await require('../persistence/agent-jobs').enqueue(
          client,
          db,
          ctx,
          row,
          jobInput,
        );
        realJobId = job.id;
        realJobKind = job.kind;
      }
      return {
        message: await repo.project(client, db, ctx, user, id),
        reply: await repo.project(client, db, ctx, ai, id),
        turnId: user.turn_id,
        actions: [],
        ...(realJobId ? { jobId: realJobId, jobKind: realJobKind } : {}),
      };
    },
  );
  for (const jobId of supersededJobs)
    await require('../agent/worker').cancel(jobId, cancelContext);
  if (result.jobId) {
    const worker = require('../agent/worker');
    const runner =
      result.jobKind === 'EXECUTE' ? worker.runExecJob : worker.runTextJob;
    void runner({ db, ctx, reqPublicId: id, jobId: result.jobId }).catch(
      () => {},
    );
  } else {
    schedule(db, ctx, id, result.reply.id);
  }
  return result;
};
module.exports.getMessages = async (id, stage, offset = 0, limit = 20) => {
  const ctx = access.current(),
    db = runtime.db();
  offset = Math.max(0, Math.floor(Number(offset) || 0));
  limit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  return withTransaction(db, async (client) => {
    await client.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    const req = (
      await client.query(
        'SELECT * FROM "' +
          db.schema +
          '".reqs WHERE tenant_id=$1 AND public_id=$2',
        [ctx.tenantId, id],
      )
    ).rows[0];
    if (!req) access.fail('NOT_FOUND', 404);
    return repo.list(client, db, ctx, req, stage, offset, limit);
  });
};
module.exports.stopMessage = async (id, mid, input) => {
  let cancellationContext;
  const result = await require('./requirement-service').mutate(
    id,
    input,
    'message.stopped',
    async (client, db, ctx, row) => {
      const m = await repo.find(client, db, ctx, row.id, mid);
      if (!m || m.role !== 'ai') access.fail('NOT_FOUND', 404);
      if (m.status === 'generating')
        await client.query(
          'UPDATE "' +
            db.schema +
            '".messages SET status=$1,revision=revision+1 WHERE tenant_id=$2 AND id=$3',
          ['stopped', ctx.tenantId, m.reply_to],
        );
      await client.query(
        'UPDATE "' +
          db.schema +
          '".messages SET status=$1,revision=revision+1 WHERE tenant_id=$2 AND id=$3 AND status=$4',
        ['stopped', ctx.tenantId, m.id, 'generating'],
      );
      // Use the persisted AI message association; command_id belongs to the user message.
      // Version detection avoids aborting a 006 transaction by querying a missing table.
      let job = null;
      if (['007', '008'].includes(db.targetVersion)) {
        job = (
          await client.query(
            `SELECT id FROM "${db.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND input->>'aiMessageId'=$3 AND state IN ('QUEUED','RUNNING','WAITING_APPROVAL') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [ctx.tenantId, row.id, m.id],
          )
        ).rows[0];
        if (job)
          await require('../persistence/agent-jobs').requestCancel(
            client,
            db,
            ctx,
            row.id,
            job.id,
          );
      }
      cancellationContext = { db, ctx, reqPublicId: id, reqId: row.id };
      return { jobId: job?.id ?? null };
    },
  );
  // Cancellation follows commit; the caller receives the actual acknowledgement.
  if (result.jobId) {
    result.cancellation = await require('../agent/worker').cancel(
      result.jobId,
      cancellationContext,
    );
  }
  return result;
};
module.exports.messageDiff = (id, mid, input) =>
  require('./requirement-service').mutate(
    id,
    input,
    'message.diff',
    async (client, db, ctx, row) => {
      const m = await repo.find(client, db, ctx, row.id, mid),
        diff = m?.metadata.diff;
      if (
        !diff ||
        m.metadata.diffApplied ||
        !['accept', 'reject'].includes(input.decision)
      )
        access.fail('INVALID_DIFF');
      const meta = {
        ...m.metadata,
        diffApplied: true,
        diffRejected: input.decision === 'reject',
      };
      if (input.decision === 'accept') {
        if (diff.stage === 'req')
          access.fail(
            'LINKED_WRITE_REQUIRED',
            409,
            '请在关联成果中比较并采纳PRD变更',
          );
        const v = require('./requirement-service').latest(
          await reqRepo.versions(client, db, ctx, row.id),
          diff.stage,
        );
        if (
          !v ||
          v.stale ||
          v.public_id !== diff.baseVersionId ||
          input.baseVersionId !== v.public_id
        )
          access.fail('STALE_VERSION');
        await repo.references(client, db, ctx, row.id, m.metadata.refs || []);
        if (['test', 'accept', 'release', 'observe'].includes(diff.stage))
          access.fail('VERIFICATION_WRITE_REQUIRED');
        const selected = input.selected || diff.fields.map((_, i) => i);
        if (
          !Array.isArray(selected) ||
          !selected.length ||
          new Set(selected).size !== selected.length ||
          selected.some((i) => !Number.isInteger(i) || !diff.fields[i])
        )
          access.fail('INVALID_DIFF', 400);
        const content = structuredClone(v.content);
        for (const index of selected) {
          const change = diff.fields[index],
            field = content.fields.find((f) => f.name === change.name);
          if (!field || field.value !== change.before)
            access.fail('STALE_VERSION');
          field.value = change.after;
        }
        await reqRepo.appendVersion(
          client,
          db,
          ctx,
          row,
          diff.stage,
          content,
          v.id,
        );
        await reqRepo.staleAfter(client, db, ctx, row.id, diff.stage);
        if (['005', '006'].includes(db.targetVersion) && diff.stage === 'dev')
          await require('../persistence/verification-baselines').invalidate(
            client,
            db,
            ctx,
            row,
          );
        if (diff.stage === 'design')
          await require('./artifact-impact-service').invalidate(
            client,
            db,
            ctx,
            row,
            '设计差异采纳',
            'design',
          );
        meta.diffDecisions = diff.fields.map((f, i) => ({
          name: f.name,
          accepted: selected.includes(i),
        }));
      }
      await client.query(
        'UPDATE "' +
          db.schema +
          '".messages SET metadata=$1,revision=revision+1 WHERE tenant_id=$2 AND id=$3',
        [JSON.stringify(meta), ctx.tenantId, m.id],
      );
      return {};
    },
  );
module.exports.recover = async () => {
  const db = runtime.db();
  await db.pool.query(
    'UPDATE "' +
      db.schema +
      '".messages SET status=$1,revision=revision+1 WHERE id IN (SELECT reply_to FROM "' +
      db.schema +
      '".messages WHERE status=$2)',
    ['stopped', 'generating'],
  );
  await db.pool.query(
    'UPDATE "' +
      db.schema +
      '".messages SET status=$1,revision=revision+1 WHERE status=$2',
    ['interrupted', 'generating'],
  );
  runtime.onClose(() => {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  });
};
