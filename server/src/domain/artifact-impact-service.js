'use strict';
const repo = require('../persistence/artifacts'),
  reqs = require('../persistence/requirements'),
  access = require('../access');
const { allocateIdentifier } = require('../persistence/identifiers');
async function inspect(client, db, ctx, req, { files = false } = {}) {
  const group = await repo.group(client, db, ctx, req),
    inputs = await repo.inputs(
      client,
      db,
      ctx,
      req,
      group?.inputs.explicitRefs || [],
    );
  const versions = await reqs.versions(client, db, ctx, req.id),
    latest = (stage) =>
      versions
        .filter((v) => v.stage === stage)
        .sort((a, b) => b.version - a.version)[0];
  const history = await repo.confirmations(client, db, ctx, req);
  const matching = (c) =>
    group &&
    c.group_id === group.id &&
    c.business_epoch === req.artifact_business_epoch &&
    c.input_fingerprint === inputs.fingerprint &&
    c.member_active &&
    ['owner', 'executor'].includes(c.current_role);
  const business = history.find((c) => c.kind === 'BUSINESS' && matching(c));
  const design =
    business &&
    history.find(
      (c) =>
        c.kind === 'DESIGN' &&
        matching(c) &&
        c.design_epoch === req.artifact_design_epoch &&
        c.design_version_id === latest('design')?.id &&
        !latest('design')?.stale &&
        latest('design')?.confirmed_at,
    );
  const questions = (
    await require('../persistence/questions').list(client, db, ctx, req.id)
  ).filter((q) => !q.answer.trim());
  const blockers = [
    ...inputs.blockers,
    ...(!group ? ['待补齐关联成果'] : []),
    ...(group && group.input_fingerprint !== inputs.fingerprint
      ? ['关联输入已变化，请比较并重新采纳候选']
      : []),
  ];
  if (files && group && blockers.length === 0)
    await repo.verifyFiles(ctx, inputs.snapshot);
  return {
    group,
    inputs,
    history,
    business: business && blockers.length === 0 ? business : null,
    design: design && blockers.length === 0 ? design : null,
    questions,
    blockers,
    latest,
  };
}
async function invalidate(
  client,
  db,
  ctx,
  req,
  reason,
  kind = 'business',
  nextGroupId,
) {
  if (!req.current_artifact_group_id && !nextGroupId) return;
  const designOnly = kind === 'design';
  const updated = (
    await client.query(
      `UPDATE ${repo.table(db, 'reqs')} SET artifact_business_epoch=artifact_business_epoch+$1,artifact_design_epoch=artifact_design_epoch+1,stage=CASE WHEN stage IN ('req','design','dev','test','accept','release') THEN $2 ELSE stage END WHERE tenant_id=$3 AND id=$4 RETURNING *`,
      [designOnly ? 0 : 1, designOnly ? 'design' : 'req', ctx.tenantId, req.id],
    )
  ).rows[0];
  const id = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'artifact_impacts',
  );
  const runs = await repo.pendingRuns(client, db, ctx, req),
    confirmations = await repo.confirmations(client, db, ctx, req);
  await client.query(
    `INSERT INTO ${repo.table(db, 'artifact_impacts')}(id,tenant_id,req_id,public_id,reason,return_stage,before_group_id,after_group_id,business_epoch,design_epoch,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id.id,
      ctx.tenantId,
      req.id,
      id.publicId,
      reason,
      designOnly ? 'design' : 'req',
      req.current_artifact_group_id || null,
      nextGroupId || req.current_artifact_group_id,
      updated.artifact_business_epoch,
      updated.artifact_design_epoch,
      JSON.stringify({
        runs,
        confirmations: confirmations
          .filter((c) => !designOnly || c.kind === 'DESIGN')
          .map((c) => c.public_id),
        preserved: ['历史版本', '确认记录', '运行与证据'],
      }),
    ],
  );
  await reqs.staleAfter(
    client,
    db,
    ctx,
    req.id,
    designOnly ? 'design' : 'idea',
  );
  return updated;
}
async function requireReady(client, db, ctx, req, stage) {
  const state = await inspect(client, db, ctx, req, { files: true });
  if (
    state.blockers.length ||
    state.questions.length ||
    !state.business ||
    (stage === 'dev' && !state.design)
  )
    access.fail(
      'ARTIFACT_CONFIRMATION_REQUIRED',
      409,
      [
        ...state.blockers,
        ...(state.questions.length ? ['仍有待决定问题'] : []),
        '请确认当前关联业务方案及实施设计',
      ].join('；'),
    );
  return state;
}
module.exports = { inspect, invalidate, requireReady };
