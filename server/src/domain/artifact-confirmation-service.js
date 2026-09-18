'use strict';
const access = require('../access'),
  artifacts = require('./artifact-service'),
  repo = require('../persistence/artifacts'),
  reqs = require('../persistence/requirements'),
  impact = require('./artifact-impact-service'),
  policy = require('./artifact-policy'),
  dto = require('./artifact-dto');
const { allocateIdentifier } = require('../persistence/identifiers'),
  { fingerprint } = require('../persistence/commands');
async function confirm(id, gid, input, kind) {
  return artifacts.mutate(
    id,
    { ...input, _target: gid },
    'confirmed.' + kind.toLowerCase(),
    async (client, db, ctx, req) => {
      const state = await impact.inspect(client, db, ctx, req, { files: true }),
        g = state.group;
      if (
        !g ||
        g.public_id !== gid ||
        state.blockers.length ||
        state.questions.length
      )
        access.fail(
          'ARTIFACT_CONFIRMATION_REQUIRED',
          409,
          [
            ...state.blockers,
            ...(state.questions.length ? ['先处理待决定问题'] : []),
          ].join('；') || '当前关联成果不可确认',
        );
      access.text(input.comment, 4000, true);
      let design,
        scope = null;
      if (kind === 'BUSINESS') {
        if (
          req.stage !== 'req' ||
          input.advanceTo !== 'design' ||
          input.inputFingerprint !== state.inputs.fingerprint
        )
          access.fail('STAGE_BLOCKED');
        if (!state.latest('idea')?.confirmed_at || state.latest('idea')?.stale)
          access.fail('STAGE_BLOCKED');
        if (g.prototype.content.representation === 'file')
          access.text(input.previewReview, 4000, true);
      } else {
        design = state.latest('design');
        if (
          req.stage !== 'design' ||
          input.advanceTo !== 'dev' ||
          !state.business ||
          design?.public_id !== input.designVersionId
        )
          access.fail('ARTIFACT_CONFIRMATION_REQUIRED');
        // 65 号：设计产物门禁——确认设计推进 dev 前，校验四类设计产物齐套且格式达标；
        // 缺失/不达标阻断推进（缺失证据不得声称可进入开发）。
        {
          const da = await require('./design-artifact-service').listForReq(
            db,
            ctx,
            req.public_id,
          );
          const required = ['design', 'sequence', 'flow', 'prototype'];
          const missing = required.filter((k) => !da[k]);
          const formatIssues = [];
          if (!missing.includes('design') && !/(背景与目标|背景)/.test(da.design.content)) formatIssues.push('方案文档缺「背景」章节');
          if (!missing.includes('design') && !/(总体架构|架构)/.test(da.design.content)) formatIssues.push('方案文档缺「总体架构」章节');
          if (!missing.includes('sequence') && !/sequenceDiagram/i.test(da.sequence.content)) formatIssues.push('时序图缺 sequenceDiagram 标记');
          if (!missing.includes('flow') && !/flowchart/i.test(da.flow.content)) formatIssues.push('流程图缺 flowchart 标记');
          if (!missing.includes('prototype') && !(/<html/i.test(da.prototype.content) && /<input/i.test(da.prototype.content) && /<button/i.test(da.prototype.content))) formatIssues.push('原型缺 HTML 交互要素（html/input/button）');
          if (missing.length || formatIssues.length)
            access.fail(
              'DESIGN_ARTIFACTS_INCOMPLETE',
              409,
              [
                ...missing.map((k) => '缺 ' + k),
                ...formatIssues,
                '请先在设计阶段完成 EXEC 作业产出四类产物，或人工补录后重试',
              ].join('；'),
            );
        }
        scope = policy.scope(input.scope);
        const caps = await require('./capability-service').context(
          client,
          db,
          ctx,
          { ...req, stage: 'dev' },
        );
        if (
          scope.capabilityIds.some(
            (id) => !caps.effectiveCaps.some((c) => c.id === id),
          )
        )
          access.fail('CAPABILITY_UNAVAILABLE');
      }
      const ident = await allocateIdentifier(
        client,
        db,
        ctx.tenantId,
        'artifact_confirmations',
      );
      const c = (
        await client.query(
          `INSERT INTO ${repo.table(db, 'artifact_confirmations')}(id,tenant_id,req_id,group_id,public_id,kind,design_version_id,business_epoch,design_epoch,input_fingerprint,scope,scope_fingerprint,comment,preview_review,member_id,role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            ident.id,
            ctx.tenantId,
            req.id,
            g.id,
            ident.publicId,
            kind,
            design?.id || null,
            req.artifact_business_epoch,
            req.artifact_design_epoch,
            state.inputs.fingerprint,
            scope ? JSON.stringify(scope) : null,
            scope ? fingerprint(scope) : null,
            input.comment,
            input.previewReview || '',
            ctx.memberId,
            ctx.role,
          ],
        )
      ).rows[0];
      await client.query(
        `UPDATE ${repo.table(db, 'req_versions')} SET confirmed_by=$1,confirmed_at=now(),stale=false,review_state='通过' WHERE tenant_id=$2 AND req_id=$3 AND id=$4`,
        [
          ctx.actor,
          ctx.tenantId,
          req.id,
          kind === 'BUSINESS' ? g.prd_id : design.id,
        ],
      );
      if (kind === 'BUSINESS') {
        const old = state.latest('design');
        if (!old || old.stale)
          await reqs.appendVersion(
            client,
            db,
            ctx,
            req,
            'design',
            old?.content || require('./templates').template(req, 'design'),
            old?.id || null,
          );
      } else {
        const old = state.latest('dev');
        if (!old || old.stale)
          await reqs.appendVersion(
            client,
            db,
            ctx,
            req,
            'dev',
            old?.content || require('./templates').template(req, 'dev'),
            old?.id || null,
          );
      }
      await client.query(
        `UPDATE ${repo.table(db, 'reqs')} SET stage=$1 WHERE tenant_id=$2 AND id=$3`,
        [kind === 'BUSINESS' ? 'design' : 'dev', ctx.tenantId, req.id],
      );
      return {
        confirmation: dto.confirmation({
          ...c,
          member_public_id: ctx.memberPublicId,
          group_public_id: g.public_id,
        }),
        nextStage: kind === 'BUSINESS' ? 'design' : 'dev',
      };
    },
  );
}
async function stageInputs(id, stage) {
  if (['test', 'accept', 'release'].includes(stage))
    return require('./verification-read-service').stageInputs(id, stage);
  if (!['design', 'dev'].includes(stage)) access.fail('INVALID_STAGE', 400);
  return artifacts.read(id, async (c, d, x, r) => {
    const state = await impact.inspect(c, d, x, r, { files: true });
    const blockers = [
      ...state.blockers,
      ...(state.questions.length ? ['仍有待决定问题'] : []),
      ...(!state.business ? ['当前业务方案尚未确认'] : []),
      ...(stage === 'dev' && !state.design ? ['当前实施设计尚未确认'] : []),
    ];
    return {
      stage,
      ready: !blockers.length,
      blockers,
      inputFingerprint: state.inputs.fingerprint,
      group: dto.group(state.group),
      businessConfirmation: dto.confirmation(state.business),
      designConfirmation: dto.confirmation(state.design),
      designVersion: state.latest('design')?.public_id || null,
      inputs: state.inputs.snapshot,
    };
  });
}
module.exports = {
  confirmBusiness: (id, gid, input) => confirm(id, gid, input, 'BUSINESS'),
  confirmDesign: (id, gid, input) => confirm(id, gid, input, 'DESIGN'),
  stageInputs,
};
