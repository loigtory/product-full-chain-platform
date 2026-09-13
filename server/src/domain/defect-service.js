'use strict';
const access = require('../access'),
  read = require('./verification-read-service'),
  policy = require('./verification-policy'),
  dto = require('./verification-dto');
const repo = require('../persistence/verification-baselines'),
  defects = require('../persistence/defects'),
  tests = require('../persistence/test-executions');
function create(id, input) {
  return read.mutate(
    id,
    input,
    'verification.defect.create',
    async (c, d, x, q) => {
      const result = await repo.required(
        c,
        d,
        x,
        q,
        'test_results',
        input.resultId,
      );
      if (result.status !== 'FAIL')
        access.fail('DEFECT_RETEST_REQUIRED', 409, '缺陷需引用失败结果');
      await read.ownerEvidence(c, d, x, q, 'result_id', result.id);
      if (await defects.fromResult(c, d, x, q, result.id))
        access.fail(
          'DEFECT_RETEST_REQUIRED',
          409,
          '该失败结果已有缺陷，请查看已有缺陷',
        );
      const row = await repo.insert(c, d, x, q, 'defects', {
        source_result_id: result.id,
        case_id: result.case_id,
        title: policy.field(input.title, '缺陷标题', true),
        description: policy.field(input.description, '缺陷描述', true),
        state: 'OPEN',
        created_by: x.memberId,
      });
      const event = await defects.event(
        c,
        d,
        x,
        q,
        row,
        'OPEN',
        row.description,
        result,
      );
      const evidence = await read.evidence(
        c,
        d,
        x,
        q,
        await repo.refs(c, d, x, q, 'result_id', result.id),
      );
      await repo.saveRefs(c, d, x, q, 'defect_event_id', event.id, evidence);
      if (['accept', 'release'].includes(q.stage))
        await repo.invalidate(c, d, x, q);
      return { defect: await dto.defect(c, d, x, q, row) };
    },
  );
}
function resolve(id, did, input) {
  return read.mutate(
    id,
    { ...input, _target: did },
    'verification.defect.resolve',
    async (c, d, x, q) => {
      const row = await repo.required(c, d, x, q, 'defects', did);
      if (!['OPEN', 'REOPEN'].includes(row.state))
        access.fail('DEFECT_RETEST_REQUIRED');
      if (await read.activeRuns(c, d, x, q))
        access.fail('TEST_HANDOFF_REQUIRED');
      const versions = await require('../persistence/requirements').versions(
          c,
          d,
          x,
          q.id,
        ),
        dev = versions
          .filter((v) => v.stage === 'dev')
          .sort((a, b) => b.version - a.version)[0];
      const source = await repo.required(
          c,
          d,
          x,
          q,
          'test_results',
          row.source_result_id,
          true,
        ),
        batch = await repo.required(
          c,
          d,
          x,
          q,
          'test_batches',
          source.batch_id,
          true,
        ),
        baseline = await repo.required(
          c,
          d,
          x,
          q,
          'delivery_baselines',
          batch.baseline_id,
          true,
        );
      if (
        dev?.public_id !== input.devVersionId ||
        dev.stale ||
        dev.id === baseline.dev_version_id
      )
        access.fail(
          'DEFECT_RETEST_REQUIRED',
          409,
          '请先保存包含修复的新开发版本',
        );
      const comment = policy.field(input.comment, '修复说明', true),
        evidence = await read.evidence(c, d, x, q, input.evidence);
      const updated = await defects.state(c, d, x, q, row, 'RESOLVED', dev),
        event = await defects.event(
          c,
          d,
          x,
          q,
          row,
          'RESOLVED',
          comment,
          null,
          dev,
        );
      await repo.saveRefs(c, d, x, q, 'defect_event_id', event.id, evidence);
      await repo.invalidate(c, d, x, q);
      return {
        defect: await dto.defect(c, d, x, q, updated),
        nextStage: q.stage,
      };
    },
  );
}
function retest(id, did, input) {
  return read.mutate(
    id,
    { ...input, _target: did },
    'verification.defect.retest',
    async (c, d, x, q) => {
      const row = await repo.required(c, d, x, q, 'defects', did);
      if (row.state !== 'RESOLVED') access.fail('DEFECT_RETEST_REQUIRED');
      const s = await read.ready(c, d, x, q),
        result = await repo.required(
          c,
          d,
          x,
          q,
          'test_results',
          input.resultId,
        ),
        batch = await repo.required(
          c,
          d,
          x,
          q,
          'test_batches',
          result.batch_id,
          true,
        );
      const source = await repo.required(
          c,
          d,
          x,
          q,
          'test_results',
          row.source_result_id,
          true,
        ),
        oldBatch = await repo.required(
          c,
          d,
          x,
          q,
          'test_batches',
          source.batch_id,
          true,
        );
      if (
        batch.baseline_id !== s.baseline.id ||
        batch.baseline_id === oldBatch.baseline_id ||
        s.baseline.dev_version_id !== row.resolved_dev_version_id ||
        result.case_id !== row.case_id ||
        !['PASS', 'FAIL'].includes(result.status) ||
        (await tests.latest(c, d, x, q, batch)).find(
          (r) => r.case_id === row.case_id,
        )?.id !== result.id
      )
        access.fail(
          'DEFECT_RETEST_REQUIRED',
          409,
          '请选择新交付中同用例的最新回归结果',
        );
      await read.validResults(c, d, x, q, batch);
      const next = result.status === 'PASS' ? 'CLOSED' : 'REOPEN';
      const comment = policy.field(input.comment, '回归结论', true);
      const updated = await defects.state(c, d, x, q, row, next),
        event = await defects.event(c, d, x, q, row, next, comment, result);
      await repo.saveRefs(
        c,
        d,
        x,
        q,
        'defect_event_id',
        event.id,
        await read.evidence(
          c,
          d,
          x,
          q,
          await repo.refs(c, d, x, q, 'result_id', result.id),
        ),
      );
      return { defect: await dto.defect(c, d, x, q, updated) };
    },
  );
}
const get = (id, did, query) =>
  read.read(id, async (c, d, x, q) => {
    const row = await repo.required(c, d, x, q, 'defects', did),
      events = [],
      page = await defects.events(c, d, x, q, row, query);
    for (const e of page.items) {
      const refs = await read.ownerEvidence(
        c,
        d,
        x,
        q,
        'defect_event_id',
        e.id,
      );
      events.push({
        id: e.public_id,
        state: e.state,
        sequence: e.sequence,
        comment: e.comment,
        evidence: refs,
        resultId: await repo.publicId(c, d, x, q, 'test_results', e.result_id),
      });
    }
    return {
      defect: await dto.defect(c, d, x, q, row),
      events,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  });
const list = (id, query) =>
  read.read(id, async (c, d, x, q) => {
    const v = await repo.list(c, d, x, q, 'defects', query);
    return {
      ...v,
      items: await Promise.all(v.items.map((r) => dto.defect(c, d, x, q, r))),
    };
  });
module.exports = { create, resolve, retest, get, list };
