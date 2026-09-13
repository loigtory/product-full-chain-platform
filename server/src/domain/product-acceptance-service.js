'use strict';
const access = require('../access'),
  read = require('./verification-read-service'),
  policy = require('./verification-policy'),
  dto = require('./verification-dto');
const repo = require('../persistence/verification-baselines'),
  reqs = require('../persistence/requirements');
function create(id, input) {
  return read.mutate(
    id,
    input,
    'productAcceptance.create',
    async (c, d, x, q) => {
      if (x.role !== 'owner') access.fail('PRODUCT_ACCEPTANCE_FORBIDDEN', 403);
      const value = policy.acceptance(input),
        s = await read.ready(c, d, x, q);
      if (q.stage !== 'accept' || input.baselineId !== s.baseline.public_id)
        access.fail('PRODUCT_ACCEPTANCE_REQUIRED');
      const batch = await repo.required(
          c,
          d,
          x,
          q,
          'test_batches',
          input.batchId,
        ),
        current =
          await require('../persistence/test-executions').currentCompleted(
            c,
            d,
            x,
            q,
            s.baseline,
          );
      if (batch.state !== 'COMPLETED' || batch.id !== current?.id)
        access.fail('TEST_RESULT_REQUIRED');
      const results = await read.testComplete(c, d, x, q, s, batch);
      const refs = await repo.refs(c, d, x, q, 'baseline_id', s.baseline.id);
      const evidence = await read.evidence(c, d, x, q, refs);
      const snapshot = {
        ...s.baseline.snapshot,
        baselineId: s.baseline.public_id,
        batchId: batch.public_id,
        testReportVersionId: await repo.publicId(
          c,
          d,
          x,
          q,
          'req_versions',
          batch.report_version_id,
        ),
        resultIds: results.map((r) => r.public_id),
        source: 'USER_REPORTED',
        evidence: refs,
      };
      const version = await reqs.appendVersion(c, d, x, q, 'accept', {
        title:
          '产品验收 · ' + (value.decision === 'ACCEPTED' ? '通过' : '驳回'),
        fields: [
          { name: '交付基线', value: s.baseline.public_id },
          { name: '测试批次', value: batch.public_id },
          { name: '验收结论', value: value.comment },
          { name: '风险', value: value.risks },
          { name: '结果来源', value: '具名人工登记，非平台自动执行' },
        ],
      });
      const row = await repo.insert(c, d, x, q, 'product_acceptances', {
        baseline_id: s.baseline.id,
        batch_id: batch.id,
        report_version_id: version.id,
        decision: value.decision,
        checks: JSON.stringify(value.checks),
        comment: value.comment,
        risks: value.risks,
        snapshot: JSON.stringify(snapshot),
        member_id: x.memberId,
      });
      await repo.saveRefs(c, d, x, q, 'acceptance_id', row.id, evidence);
      if (value.decision === 'ACCEPTED') {
        await repo.confirmVersion(c, d, x, q, version.id);
        await repo.stage(c, d, x, q, 'release');
      } else await repo.invalidate(c, d, x, q);
      return {
        acceptance: await dto.acceptance(c, d, x, q, row),
        nextStage: q.stage,
      };
    },
  );
}
const get = (id, aid) =>
  read.read(id, async (c, d, x, q) => {
    const row = await repo.required(c, d, x, q, 'product_acceptances', aid);
    await read.ownerEvidence(c, d, x, q, 'acceptance_id', row.id);
    return { acceptance: await dto.acceptance(c, d, x, q, row) };
  });
const list = (id, query) =>
  read.read(id, async (c, d, x, q) => {
    const v = await repo.list(c, d, x, q, 'product_acceptances', query);
    return { ...v, items: v.items.map(dto.summary) };
  });
module.exports = { create, get, list };
