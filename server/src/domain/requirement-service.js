'use strict';
const { S, seedFromState, pushAudit, pushNotice, nextId } = require('./store');
const sm = require('./state-machine');
const wsBridge = require('../ws');
// Existing memory demonstration adapter; no PG caller may enter this block.
async function listReqs(stage, q) {
  await seedFromState();
  const items = [...S.reqs.values()]
    .filter(
      (r) =>
        (!stage || r.stage === stage) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)),
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      stage: r.stage,
      owner: r.owner,
      goal: r.goal,
      closed: r.closed,
    }));
  return { items, total: items.length };
}

async function getReq(id) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return null;
  return {
    ...req,
    versions: [...S.versions.values()].filter((v) => v.reqId === id),
    materials: [...S.materials.values()].filter((m) => m.reqId === id),
    questions: [...S.questions.values()].filter((q) => q.reqId === id),
    caps: [],
    units: [],
  };
}

/* 创建需求：服务端做知识库自动检索（keyword 顶替向量检索，13 号第十节） */

async function createReq({ name, goal, scope, owner, projectId }) {
  await seedFromState();
  const id = nextId('R');
  S.reqs.set(id, {
    id,
    name: name || '未命名需求',
    goal: goal || '',
    scope: scope || '',
    owner: owner || '陈立',
    stage: 'idea',
    projectId: projectId || null,
    closed: false,
    createdAt: new Date().toISOString(),
  });
  const content = {
    id: id + '-idea-v1',
    version: 1,
    title: '需求草案',
    fields: [
      { name: '需求名称', value: name },
      { name: '目标', value: goal },
      { name: '范围', value: scope },
    ],
    confirmed: false,
    review: '待评审',
    comments: [],
    createdAt: new Date().toISOString(),
  };
  S.versions.set('SV-' + S.seq.ver, {
    id: 'SV-' + S.seq.ver++,
    reqId: id,
    stage: 'idea',
    version: 1,
    content,
    confirmedBy: null,
    confirmedAt: null,
    stale: false,
  });
  /* 知识库 keyword 检索（模拟）：匹配目标词返回条目 */
  const knowledgeRefs = [...(S.knowledge || [])]
    .filter((k) =>
      [name, goal, scope].some(
        (t) =>
          (t && k.title.includes(t)) ||
          (t && k.tags.some((tag) => (t || '').includes(tag))),
      ),
    )
    .slice(0, 3)
    .map((k) => ({ id: k.id, title: k.title }));
  pushAudit(owner || '陈立', '需求登记', name || id);
  return { req: await getReq(id), knowledgeRefs };
}

/* 阶段推进：服务端校验全部阻塞条件（状态机门控） */

async function advanceStage(id, to) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const bl = sm.blockers(S, req, to);
  if (bl.length) return { req: await getReq(id), blockers: bl };
  req.stage = to;
  pushAudit('陈立', '阶段推进', id + ' → ' + to);
  return { req: await getReq(id), blockers: [] };
}

/* 确认版本：使下游评审过期（stale） */

async function confirmVersion(id, vid) {
  await seedFromState();
  const v = S.versions.get(vid);
  if (!v || v.reqId !== id) return { error: 'NOT_FOUND' };
  const latest = [...S.versions.values()]
    .filter((x) => x.reqId === id && x.stage === v.stage)
    .sort((a, b) => b.version - a.version)[0];
  if (latest?.id !== vid) return { error: 'STALE_VERSION' };
  v.confirmedBy = '陈立';
  v.confirmedAt = new Date().toISOString();
  v.stale = false;
  for (const other of S.versions.values()) {
    if (
      other.reqId === id &&
      sm.STAGES.indexOf(other.stage) > sm.STAGES.indexOf(v.stage)
    )
      other.stale = true;
  }
  pushAudit('陈立', '确认版本', id + ' ' + v.stage + ' v' + v.version);
  return { version: v };
}

async function getVersions(id, stage) {
  await seedFromState();
  const all = [...S.versions.values()]
    .filter((v) => v.reqId === id && (!stage || v.stage === stage))
    .sort((a, b) => b.version - a.version);
  return { versions: all };
}

// Explicit draft registration: UI templates are not confirmations or test evidence.

async function saveVersion(id, { stage, content }) {
  await seedFromState();
  if (!S.reqs.has(id)) return { error: 'NOT_FOUND' };
  if (
    !['idea', 'req', 'design', 'dev'].includes(stage) ||
    !content?.id ||
    !Number.isInteger(content.version) ||
    content.version < 1 ||
    !Array.isArray(content.fields) ||
    !content.fields.length ||
    content.fields.some(
      (f) =>
        typeof f.name !== 'string' ||
        typeof f.value !== 'string' ||
        !f.value.trim(),
    )
  )
    return { error: 'INVALID_VERSION' };
  const versions = [...S.versions.values()].filter(
    (v) => v.reqId === id && v.stage === stage,
  );
  if (versions.some((v) => v.version > content.version))
    return { error: 'STALE_VERSION' };
  const existing = versions.find((v) => v.version === content.version);
  if (existing?.confirmedAt) {
    if (
      JSON.stringify(existing.content.fields) !== JSON.stringify(content.fields)
    )
      return { error: 'STALE_VERSION' };
    return { version: existing };
  }
  const vid = existing?.id || 'SV-' + S.seq.ver++;
  const version = {
    id: vid,
    reqId: id,
    stage,
    version: content.version,
    content: { ...content, confirmed: false },
    confirmedBy: null,
    confirmedAt: null,
    stale: false,
  };
  S.versions.set(vid, version);
  return { version };
}
const memory = {
  listReqs,
  getReq,
  createReq,
  advanceStage,
  confirmVersion,
  getVersions,
  saveVersion,
};
module.exports = { memory };

// Persistent requirement aggregate. All modifications share one locked revision.
const runtime = require('../runtime'),
  access = require('../access'),
  repo = require('../persistence/requirements');
const dto = require('./dto'),
  templates = require('./templates'),
  { command } = require('../persistence/commands');
const { withTransaction } = require('../persistence/transaction');
const questionRepo = require('../persistence/questions'),
  materialRepo = require('../persistence/materials');
async function detail(client, db, ctx, row) {
  const project = row.project_id
    ? require('./project-service').dto(
        await require('./project-service').required(
          client,
          db,
          ctx,
          row.project_id,
        ),
      )
    : null;
  const capabilityContext = await require('./capability-service').context(
    client,
    db,
    ctx,
    row,
  );
  const versions = await repo.versions(client, db, ctx, row.id);
  const reviews = (
    await client.query(
      'SELECT r.*,v.public_id version_public_id FROM "' +
        db.schema +
        '".req_version_reviews r JOIN "' +
        db.schema +
        '".req_versions v ON v.tenant_id=r.tenant_id AND v.id=r.version_id WHERE r.tenant_id=$1 AND r.req_id=$2 ORDER BY r.created_at',
      [ctx.tenantId, row.id],
    )
  ).rows;
  const audit = (
    await client.query(
      'SELECT public_id id,actor,action,detail,created_at time FROM "' +
        db.schema +
        '".audit_logs WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at DESC LIMIT 200',
      [ctx.tenantId, row.id],
    )
  ).rows;
  return {
    ...dto.req(row),
    ...(db.targetVersion === '005'
      ? {
          verification: await require('./verification-read-service').workspace(
            client,
            db,
            ctx,
            row,
          ),
        }
      : {}),
    projectId: project?.id || null,
    project,
    knowledgeRefs: await require('../persistence/knowledge').refs(
      client,
      db,
      ctx,
      row.id,
    ),
    overrides: capabilityContext.overrides,
    effectiveCaps: capabilityContext.effectiveCaps,
    bindingRevision: capabilityContext.bindingRevision,
    audit,
    versions: versions.map((v) =>
      dto.version(
        v,
        row.public_id,
        reviews
          .filter((r) => r.version_id === v.id)
          .map((r) => ({
            by: r.actor,
            text: r.comment,
            result: r.result,
            at: dto.iso(r.created_at),
          })),
      ),
    ),
    questions: (await questionRepo.list(client, db, ctx, row.id)).map((q) =>
      dto.question(q, row.public_id),
    ),
    materials: (await materialRepo.list(client, db, ctx, row.id)).map((m) =>
      dto.material(m, row.public_id),
    ),
    caps: [], // 产品 CAP 尚未接入；工具能力单独通过 effectiveCaps 返回。
    units: [],
  };
}
async function readDetail(id) {
  const ctx = access.current(),
    db = runtime.db();
  return withTransaction(db, async (client) => {
    await client.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    const row = (
      await client.query(
        'SELECT * FROM "' +
          db.schema +
          '".reqs WHERE tenant_id=$1 AND public_id=$2',
        [ctx.tenantId, id],
      )
    ).rows[0];
    return row ? detail(client, db, ctx, row) : null;
  });
}
async function mutate(id, input, operation, work) {
  const ctx = access.current(true),
    db = runtime.db();
  return command(db, ctx, operation + ':' + id, input, async (client) => {
    const row = await repo.lock(client, db, ctx, id);
    access.revision(row, input.expectedRevision);
    const artifacts = require('../persistence/artifacts');
    const originalGroup = row.current_artifact_group_id
      ? await artifacts.group(client, db, ctx, row)
      : null;
    const before = originalGroup
      ? await artifacts.inputs(
          client,
          db,
          ctx,
          row,
          originalGroup.inputs.explicitRefs,
        )
      : null;
    const result = await work(client, db, ctx, row);
    if (originalGroup) {
      const fresh = (
        await client.query(
          'SELECT * FROM "' + db.schema + '".reqs WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, row.id],
        )
      ).rows[0];
      const after = await artifacts.inputs(
        client,
        db,
        ctx,
        fresh,
        originalGroup.inputs.explicitRefs,
      );
      if (before.fingerprint !== after.fingerprint)
        await require('./artifact-impact-service').invalidate(
          client,
          db,
          ctx,
          row,
          operation,
          'business',
        );
      else if (operation === 'version.saved' && input.stage === 'design')
        await require('./artifact-impact-service').invalidate(
          client,
          db,
          ctx,
          row,
          operation,
          'design',
        );
    }
    if (
      db.targetVersion === '005' &&
      operation === 'version.saved' &&
      input.stage === 'dev'
    )
      await require('../persistence/verification-baselines').invalidate(
        client,
        db,
        ctx,
        row,
      );
    const current = await repo.touch(client, db, ctx, row, operation);
    return { ...result, req: await detail(client, db, ctx, current) };
  });
}
function latest(versions, stage) {
  return versions
    .filter((v) => v.stage === stage)
    .sort((a, b) => b.version - a.version)[0];
}
async function blockersPg(client, db, ctx, row) {
  const questions = await questionRepo.list(client, db, ctx, row.id),
    materials = await materialRepo.list(client, db, ctx, row.id);
  return [
    ...(row.stage === 'idea' && questions.some((q) => !q.answer.trim())
      ? ['仍有未回答的澄清问题']
      : []),
    ...(materials.some((m) => m.status === '待确认影响')
      ? ['材料影响尚未处理']
      : []),
  ];
}
module.exports.getReq = readDetail;
module.exports.listReqs = async (stage, q) => {
  const ctx = access.current(),
    db = runtime.db();
  const rows = (
    await db.pool.query(
      'SELECT q.*,p.public_id project_public_id FROM "' +
        db.schema +
        '".reqs q LEFT JOIN "' +
        db.schema +
        '".projects p ON p.tenant_id=q.tenant_id AND p.id=q.project_id WHERE q.tenant_id=$1 AND ($2::text IS NULL OR q.stage=$2) AND (q.name ILIKE $3 OR q.public_id ILIKE $3) ORDER BY q.created_at LIMIT 200',
      [ctx.tenantId, stage || null, '%' + (q || '') + '%'],
    )
  ).rows;
  return { items: rows.map(dto.req), total: rows.length };
};
module.exports.createReq = async (input) => {
  const ctx = access.current(true),
    db = runtime.db();
  access.text(input.name, 80, true);
  access.text(input.goal || '', 8000);
  access.text(input.scope || '', 8000);
  access.text(input.owner || ctx.actor, 160, true);
  return command(db, ctx, 'requirement.create', input, async (client) => {
    const project = input.projectId
      ? await require('./project-service').required(
          client,
          db,
          ctx,
          input.projectId,
        )
      : null;
    let row = await repo.insert(client, db, ctx, input);
    if (project)
      row = await repo.associateProject(client, db, ctx, row, project.id);
    const knowledgeRefs = await require('./knowledge-service').capture(
      client,
      db,
      ctx,
      row,
    );
    await repo.appendVersion(
      client,
      db,
      ctx,
      row,
      'idea',
      templates.template(row, 'idea'),
    );
    await questionRepo.create(client, db, ctx, row.id, templates.questions);
    await materialRepo.create(client, db, ctx, row.id, {
      name: '原始想法',
      content: input.goal || '',
      classification: '内部',
      allowed: true,
      usage: 'material',
      status: '已纳入',
    });
    const updated = await repo.touch(
      client,
      db,
      ctx,
      row,
      'requirement.created',
    );
    return { req: await detail(client, db, ctx, updated), knowledgeRefs };
  });
};
module.exports.getVersions = async (id, stage) => {
  const value = await readDetail(id);
  if (!value) access.fail('NOT_FOUND', 404);
  return {
    versions: value.versions.filter((v) => !stage || v.stage === stage),
  };
};
module.exports.saveVersion = (id, input) =>
  mutate(id, input, 'version.saved', async (client, db, ctx, row) => {
    if (['test', 'accept', 'release'].includes(input.stage))
      access.fail(
        'VERIFICATION_WRITE_REQUIRED',
        409,
        '请使用测试或产品验收动作生成报告',
      );
    if (input.stage === 'req')
      access.fail(
        'LINKED_WRITE_REQUIRED',
        409,
        '请在关联成果中比较并采纳PRD变更',
      );
    if (
      !['idea', 'req', 'design', 'dev'].includes(input.stage) ||
      sm.STAGES.indexOf(input.stage) > sm.STAGES.indexOf(row.stage)
    )
      access.fail('INVALID_VERSION', 400);
    const fields = input.content?.fields;
    if (!Array.isArray(fields) || !fields.length || fields.length > 40)
      access.fail('INVALID_VERSION', 400);
    for (const f of fields) {
      access.text(f.name, 160, true);
      access.text(f.value, 16000, true);
    }
    const old = latest(
      await repo.versions(client, db, ctx, row.id),
      input.stage,
    );
    if (!old || old.public_id !== input.baseVersionId)
      access.fail('STALE_VERSION');
    const v = await repo.appendVersion(
      client,
      db,
      ctx,
      row,
      input.stage,
      input.content,
      old.id,
    );
    await repo.staleAfter(client, db, ctx, row.id, input.stage);
    return { version: dto.version(v, id) };
  });
module.exports.confirmVersion = (id, vid, input = {}) =>
  mutate(id, input, 'version.confirmed', async (client, db, ctx, row) => {
    const versions = await repo.versions(client, db, ctx, row.id),
      v = versions.find((v) => v.public_id === vid);
    if (!v) access.fail('NOT_FOUND', 404);
    if (db.targetVersion === '005')
      await require('./verification-read-service').guardVersion(
        client,
        db,
        ctx,
        row,
        v,
      );
    if (['req', 'design'].includes(v.stage))
      access.fail(
        'ARTIFACT_CONFIRMATION_REQUIRED',
        409,
        '请确认当前关联业务方案或实施设计',
      );
    if (latest(versions, v.stage)?.id !== v.id || v.stale)
      access.fail('STALE_VERSION');
    const blockers = await blockersPg(client, db, ctx, row);
    if (blockers.length) access.fail('STAGE_BLOCKED', 409, blockers.join('；'));
    const updated = (
      await client.query(
        'UPDATE "' +
          db.schema +
          '".req_versions SET confirmed_by=$1,confirmed_at=coalesce(confirmed_at,now()),review_state=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *',
        [ctx.actor, '通过', ctx.tenantId, v.id],
      )
    ).rows[0];
    await repo.staleAfter(client, db, ctx, row.id, v.stage);
    return { version: dto.version(updated, id) };
  });
module.exports.advanceStage = (id, to, input = {}) =>
  mutate(id, input, 'requirement.advanced', async (client, db, ctx, row) => {
    const verificationGate = {
      test: 'TEST_HANDOFF_REQUIRED',
      accept: 'TEST_COMPLETION_REQUIRED',
      release: 'PRODUCT_ACCEPTANCE_REQUIRED',
    }[to];
    if (verificationGate)
      access.fail(
        verificationGate,
        409,
        '请使用当前测试/验收主动作完成阶段交接',
      );
    if (!['req', 'design', 'dev'].includes(to))
      access.fail('CAPABILITY_UNAVAILABLE', 409, '该阶段 PG 写入尚未接入');
    if (['design', 'dev'].includes(to))
      await require('./artifact-impact-service').requireReady(
        client,
        db,
        ctx,
        row,
        to,
      );
    const v = latest(await repo.versions(client, db, ctx, row.id), row.stage),
      blockers = await blockersPg(client, db, ctx, row);
    if (
      sm.NEXT[row.stage] !== to ||
      !v?.confirmed_at ||
      v.stale ||
      blockers.length
    )
      access.fail(
        'STAGE_BLOCKED',
        409,
        blockers.join('；') || '请按顺序确认当前最新版本',
      );
    await client.query(
      'UPDATE "' +
        db.schema +
        '".reqs SET stage=$1 WHERE tenant_id=$2 AND id=$3',
      [to, ctx.tenantId, row.id],
    );
    if (!latest(await repo.versions(client, db, ctx, row.id), to))
      await repo.appendVersion(
        client,
        db,
        ctx,
        row,
        to,
        templates.template(row, to),
      );
    return { blockers: [] };
  });
module.exports.reviewVersion = (id, vid, input) =>
  mutate(id, input, 'version.reviewed', async (client, db, ctx, row) => {
    if (!['通过', '需修改', '意见'].includes(input.result))
      access.fail('INVALID_REVIEW', 400);
    access.text(input.comment || '', 4000, true);
    const versions = await repo.versions(client, db, ctx, row.id),
      v = versions.find((v) => v.public_id === vid);
    if (!v || latest(versions, v.stage)?.id !== v.id || v.stale)
      access.fail('STALE_VERSION');
    if (db.targetVersion === '005')
      await require('./verification-read-service').guardVersion(
        client,
        db,
        ctx,
        row,
        v,
      );
    const identity =
      await require('../persistence/identifiers').allocateIdentifier(
        client,
        db,
        ctx.tenantId,
        'req_version_reviews',
      );
    await client.query(
      'INSERT INTO "' +
        db.schema +
        '".req_version_reviews(id,tenant_id,req_id,version_id,public_id,actor,result,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        identity.id,
        ctx.tenantId,
        row.id,
        v.id,
        identity.publicId,
        ctx.actor,
        input.result,
        input.comment,
      ],
    );
    await client.query(
      'UPDATE "' +
        db.schema +
        '".req_versions SET review_state=$1,confirmed_at=CASE WHEN $1=$4 THEN NULL ELSE confirmed_at END,confirmed_by=CASE WHEN $1=$4 THEN NULL ELSE confirmed_by END WHERE tenant_id=$2 AND id=$3',
      [input.result, ctx.tenantId, v.id, '需修改'],
    );
    if (input.result === '需修改') {
      await repo.staleAfter(client, db, ctx, row.id, v.stage);
      await require('./artifact-impact-service').invalidate(
        client,
        db,
        ctx,
        row,
        '版本评审需修改',
        v.stage === 'design' ? 'design' : 'business',
      );
    }
    return {};
  });
module.exports.answerQuestion = (id, qid, input) =>
  mutate(id, input, 'question.answered', async (client, db, ctx, row) => {
    access.text(input.answer, 8000, true);
    const q = await questionRepo.answer(
      client,
      db,
      ctx,
      row.id,
      qid,
      input.answer,
    );
    if (!q) access.fail('NOT_FOUND', 404);
    const old = latest(await repo.versions(client, db, ctx, row.id), 'idea'),
      content = structuredClone(old.content);
    const field = content.fields.find((f) => f.name === q.q);
    if (field) field.value = input.answer;
    else content.fields.push({ name: q.q, value: input.answer });
    const v = await repo.appendVersion(
      client,
      db,
      ctx,
      row,
      'idea',
      content,
      old.id,
    );
    await repo.staleAfter(client, db, ctx, row.id, 'idea');
    return { question: dto.question(q, id), version: dto.version(v, id) };
  });
module.exports.mutate = mutate;
module.exports.associateProject = (id, input) =>
  mutate(id, input, 'requirement.project', async (client, db, ctx, row) => {
    const project = await require('./project-service').required(
      client,
      db,
      ctx,
      input.projectId,
    );
    if (row.project_id !== project.id)
      await repo.associateProject(client, db, ctx, row, project.id, true);
    return {};
  });
module.exports.detail = detail;
module.exports.latest = latest;
