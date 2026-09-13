'use strict';
const access = require('../access'),
  read = require('./verification-read-service'),
  policy = require('./verification-policy'),
  dto = require('./verification-dto');
const repo = require('../persistence/verification-baselines'),
  tests = require('../persistence/test-executions'),
  suites = require('../persistence/test-suites'),
  reqs = require('../persistence/requirements');
function create(id, input) {
  return read.mutate(
    id,
    input,
    'verification.batch.create',
    async (c, d, x, q) => {
      const s = await read.ready(c, d, x, q);
      if (
        !['test', 'accept', 'release'].includes(q.stage) ||
        input.baselineId !== s.baseline.public_id
      )
        access.fail('TEST_BASELINE_STALE');
      if (input.source !== 'USER_REPORTED')
        access.fail('INVALID_TEST_SOURCE', 400);
      if ((await tests.countOpen(c, d, x, q)) >= policy.limits.openBatches)
        access.fail(
          'VERIFICATION_LIMIT_EXCEEDED',
          409,
          '最多保留5个进行中批次',
        );
      const row = await repo.insert(c, d, x, q, 'test_batches', {
        baseline_id: s.baseline.id,
        suite_id: s.suite.id,
        environment: policy.field(input.environment, '测试环境', true),
        source: 'USER_REPORTED',
        created_by: x.memberId,
      });
      if (q.stage === 'accept') {
        await reqs.staleAfter(c, d, x, q.id, 'dev');
        await repo.stage(c, d, x, q, 'test');
      }
      return { batch: await dto.batch(c, d, x, q, row) };
    },
  );
}
async function current(c, d, x, q, bid) {
  const row = await repo.required(c, d, x, q, 'test_batches', bid);
  if (row.state !== 'OPEN')
    access.fail('TEST_BATCH_FINAL', 409, '批次已结束，请新建批次');
  const state = await read.ready(c, d, x, q);
  if (row.baseline_id !== state.baseline.id) access.fail('TEST_BASELINE_STALE');
  return { row, state };
}
function addResults(id, bid, input) {
  return read.mutate(
    id,
    { ...input, _target: bid },
    'verification.results.append',
    async (c, d, x, q) => {
      const { row: batch, state } = await current(c, d, x, q, bid),
        values = policy
          .list(input.results, policy.limits.batchWrite, '结果')
          .map(policy.result);
      if (!values.length) access.fail('TEST_RESULT_REQUIRED');
      if (new Set(values.map((v) => v.caseId)).size !== values.length)
        access.fail('DUPLICATE_TEST_CASE', 400);
      const cases = await suites.cases(c, d, x, q, state.suite),
        latest = await tests.latest(c, d, x, q, batch),
        total = (await tests.results(c, d, x, q, batch, { limit: 1 })).total;
      if (total + values.length > policy.limits.results)
        access.fail(
          'VERIFICATION_LIMIT_EXCEEDED',
          409,
          '批次历史已达上限，请新建批次',
        );
      const out = [];
      for (const value of values) {
        if (!cases.some((r) => r.case_id === value.caseId))
          access.fail('INVALID_TEST_REFERENCE', 400, '用例不属于当前套件');
        const prior = latest.find((r) => r.case_id === value.caseId);
        if (
          value.sequence !== (prior?.sequence || 0) + 1 ||
          value.previousResultId !== (prior?.public_id || null)
        )
          access.fail('REVISION_CONFLICT', 409, '该用例已有新结果，请重新读取');
        const evidence = await read.evidence(
          c,
          d,
          x,
          q,
          value.evidence,
          ['PASS', 'FAIL'].includes(value.status),
        );
        const row = await repo.insert(c, d, x, q, 'test_results', {
          batch_id: batch.id,
          suite_id: batch.suite_id,
          case_id: value.caseId,
          sequence: value.sequence,
          previous_result_id: prior?.id || null,
          status: value.status,
          source: 'USER_REPORTED',
          actual: value.actual,
          reason: value.reason,
          executed_at: value.executedAt,
          registered_by: x.memberId,
        });
        await repo.saveRefs(c, d, x, q, 'result_id', row.id, evidence);
        out.push(await dto.result(c, d, x, q, row));
      }
      if (q.stage === 'release') await repo.invalidate(c, d, x, q);
      else if (q.stage === 'accept') {
        await reqs.staleAfter(c, d, x, q.id, 'dev');
        await repo.stage(c, d, x, q, 'test');
      }
      return { results: out, batchId: bid };
    },
  );
}
function complete(id, bid, input) {
  return read.mutate(
    id,
    { ...input, _target: bid },
    'verification.batch.complete',
    async (c, d, x, q) => {
      const { row: batch, state } = await current(c, d, x, q, bid);
      if (q.stage !== 'test') access.fail('TEST_COMPLETION_REQUIRED');
      const values = await read.testComplete(c, d, x, q, state, batch);
      const version = await reqs.appendVersion(c, d, x, q, 'test', {
        title: '测试报告 · 人工登记',
        fields: [
          { name: '交付基线', value: state.baseline.public_id },
          { name: '测试批次', value: batch.public_id },
          { name: '测试环境', value: batch.environment },
          {
            name: '结果来源',
            value: 'USER_REPORTED（具名人工登记，平台未执行）',
          },
          {
            name: '必测结果',
            value: values
              .map((v) => v.case_id + '：' + v.status + ' / ' + v.public_id)
              .join('\n'),
          },
        ],
      });
      await repo.confirmVersion(c, d, x, q, version.id);
      const row = await tests.finalize(c, d, x, q, batch, 'COMPLETED', version);
      await repo.stage(c, d, x, q, 'accept');
      return { batch: await dto.batch(c, d, x, q, row), nextStage: 'accept' };
    },
  );
}
function cancel(id, bid, input) {
  return read.mutate(
    id,
    { ...input, _target: bid },
    'verification.batch.cancel',
    async (c, d, x, q) => {
      const reason = policy.field(input.reason, '取消原因', true);
      const batch = await repo.required(c, d, x, q, 'test_batches', bid);
      if (batch.state !== 'OPEN') access.fail('TEST_BATCH_FINAL');
      const row = await tests.finalize(
        c,
        d,
        x,
        q,
        batch,
        'CANCELLED',
        null,
        reason,
      );
      return { batch: await dto.batch(c, d, x, q, row) };
    },
  );
}
const get = (id, bid, query) =>
  read.read(id, async (c, d, x, q) => {
    const batch = await repo.required(c, d, x, q, 'test_batches', bid),
      list = await tests.results(c, d, x, q, batch, query),
      items = [];
    for (const r of list.items) {
      await read.ownerEvidence(
        c,
        d,
        x,
        q,
        'result_id',
        r.id,
        ['PASS', 'FAIL'].includes(r.status),
      );
      items.push(await dto.result(c, d, x, q, r));
    }
    return {
      batch: await dto.batch(c, d, x, q, batch),
      results: { ...list, items },
      latest: (await tests.latest(c, d, x, q, batch)).map((r) => ({
        id: r.public_id,
        caseId: r.case_id,
        status: r.status,
        sequence: r.sequence,
      })),
    };
  });
const list = (id, query) =>
  read.read(id, async (c, d, x, q) => {
    const v = await repo.list(c, d, x, q, 'test_batches', query);
    return {
      ...v,
      items: await Promise.all(v.items.map((r) => dto.batch(c, d, x, q, r))),
    };
  });
module.exports = { create, addResults, complete, cancel, get, list };
