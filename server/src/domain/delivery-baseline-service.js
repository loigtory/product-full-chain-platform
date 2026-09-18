'use strict';
const access = require('../access'),
  read = require('./verification-read-service'),
  policy = require('./verification-policy'),
  dto = require('./verification-dto');
const repo = require('../persistence/verification-baselines'),
  reqs = require('../persistence/requirements'),
  impact = require('./artifact-impact-service');
function create(id, input) {
  return read.mutate(
    id,
    input,
    'verification.delivery.create',
    async (c, d, x, q) => {
      // 67 号：dev→test 真实 EXEC 证据门禁——开发不是填表，
      // 提测前必须存在 dev 阶段真实 EXEC 代码作业（平台检出 SUCCEEDED 记录）。
      {
        const hit = await c.query(
          `SELECT 1 FROM "${d.schema}".agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND kind='EXECUTE' AND state='SUCCEEDED' AND input->>'stage'='dev' LIMIT 1`,
          [x.tenantId, q.id],
        );
        if (!hit.rowCount)
          access.fail(
            'DEV_EXEC_EVIDENCE_REQUIRED',
            409,
            '开发阶段尚未完成真实 EXEC 代码作业（平台未检出任何 dev 阶段成功执行记录）。请先在开发阶段发起真实执行完成代码实现并通过，再交接测试。',
          );
      }
      const value = policy.delivery(input),
        state = await impact.inspect(c, d, x, q, { files: true });
      if (
        q.stage !== 'dev' ||
        !state.business ||
        !state.design ||
        state.blockers.length ||
        state.questions.length
      )
        access.fail(
          'TEST_HANDOFF_REQUIRED',
          409,
          '请先完成当前业务方案和设计确认',
        );
      if (await read.activeRuns(c, d, x, q))
        access.fail(
          'TEST_HANDOFF_REQUIRED',
          409,
          '仍有运行中、取消中或结果未知的作业',
        );
      const suite = await repo.find(
          c,
          d,
          x,
          q,
          'test_suites',
          q.current_test_suite_id,
          true,
        ),
        dev = state.latest('dev');
      if (
        !suite ||
        suite.status !== 'READY' ||
        suite.group_id !== state.group.id
      )
        access.fail('TEST_SUITE_INCOMPLETE');
      if (
        dev?.public_id !== value.devVersionId ||
        dev.stale ||
        !dev.content.fields?.length ||
        dev.content.fields.some(
          (f) =>
            !f.value?.trim() ||
            /待补充|待实现|待填写|^TODO$|^TBD$/i.test(f.value),
        )
      )
        access.fail(
          'TEST_HANDOFF_REQUIRED',
          409,
          '先保存本次开发交付的实质内容',
        );
      if (!q.project_id)
        access.fail('TEST_HANDOFF_REQUIRED', 409, '先关联本次交付项目');
      const project = await require('./project-service').required(
        c,
        d,
        x,
        q.project_id,
      );
      if (value.runId) {
        const run = await repo.run(c, d, x, q, value.runId);
        if (
          !run ||
          run.snapshot_version !== 2 ||
          run.context_snapshot?.linkedArtifacts?.groupId !==
            state.group.public_id ||
          run.context_snapshot?.linkedArtifacts?.businessConfirmationId !==
            state.business.public_id ||
          run.context_snapshot?.linkedArtifacts?.designConfirmationId !==
            state.design.public_id ||
          run.context_snapshot?.linkedArtifacts?.inputFingerprint !==
            state.inputs.fingerprint
        )
          access.fail('TEST_BASELINE_STALE', 409, '作业输入与交付关联组不一致');
        value.runSource = 'SIMULATED';
      }
      const evidence = await read.evidence(c, d, x, q, value.evidence);
      if (q.current_delivery_baseline_id) await repo.invalidate(c, d, x, q);
      const snapshot = {
        groupId: state.group.public_id,
        businessConfirmationId: state.business.public_id,
        designConfirmationId: state.design.public_id,
        devVersionId: dev.public_id,
        suiteId: suite.public_id,
        suiteFingerprint: suite.fingerprint,
        projectId: project.public_id,
        inputFingerprint: state.inputs.fingerprint,
        source: 'USER_REPORTED',
      };
      const row = await repo.insert(c, d, x, q, 'delivery_baselines', {
        group_id: state.group.id,
        suite_id: suite.id,
        dev_version_id: dev.id,
        business_confirmation_id: state.business.id,
        design_confirmation_id: state.design.id,
        project_id: q.project_id,
        verification_epoch: q.verification_epoch,
        input_fingerprint: state.inputs.fingerprint,
        fingerprint: require('../persistence/commands').fingerprint({
          snapshot,
          subject: value,
          epoch: q.verification_epoch,
        }),
        snapshot: JSON.stringify(snapshot),
        subject: JSON.stringify(value),
        created_by: x.memberId,
      });
      await repo.saveRefs(c, d, x, q, 'baseline_id', row.id, evidence);
      await repo.confirmVersion(c, d, x, q, dev.id);
      await reqs.staleAfter(c, d, x, q.id, 'dev');
      await repo.setCurrent(c, d, x, q, row);
      await repo.stage(c, d, x, q, 'test');
      return {
        delivery: await dto.baseline(c, d, x, q, row),
        nextStage: 'test',
      };
    },
  );
}
const get = (id, bid) =>
  read.read(id, async (c, d, x, q) => {
    const row = await repo.required(c, d, x, q, 'delivery_baselines', bid);
    await read.ownerEvidence(c, d, x, q, 'baseline_id', row.id);
    return { delivery: await dto.baseline(c, d, x, q, row) };
  });
const list = (id, query) =>
  read.read(id, async (c, d, x, q) => {
    const v = await repo.list(c, d, x, q, 'delivery_baselines', query);
    return { ...v, items: v.items.map(dto.summary) };
  });
module.exports = { create, get, list };
