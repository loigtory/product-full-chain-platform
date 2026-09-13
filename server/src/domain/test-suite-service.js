'use strict';
const access = require('../access'),
  read = require('./verification-read-service'),
  policy = require('./verification-policy'),
  dto = require('./verification-dto');
const repo = require('../persistence/verification-baselines'),
  suites = require('../persistence/test-suites'),
  artifacts = require('../persistence/artifacts');
function changes(before, after) {
  const a = new Map(before.map((c) => [c.caseId, c])),
    b = new Map(after.map((c) => [c.caseId, c]));
  const hash = require('../persistence/commands').fingerprint;
  return {
    added: after.filter((c) => !a.has(c.caseId)).map((c) => c.caseId),
    removed: before.filter((c) => !b.has(c.caseId)).map((c) => c.caseId),
    changed: after
      .filter((c) => a.has(c.caseId) && hash(c) !== hash(a.get(c.caseId)))
      .map((c) => c.caseId),
  };
}
function create(id, input) {
  return read.mutate(
    id,
    input,
    'verification.suite.create',
    async (c, d, x, q) => {
      if (q.stage === 'observe') access.fail('CAPABILITY_UNAVAILABLE');
      const group = await artifacts.group(c, d, x, q);
      if (!group || input.baseGroupId !== group.public_id)
        access.fail('TEST_BASELINE_STALE', 409, '关联组已变化，请重新比较');
      const parent = input.baseSuiteId
        ? await repo.required(c, d, x, q, 'test_suites', input.baseSuiteId)
        : null;
      const value = policy.suite(group, input),
        row = await suites.create(c, d, x, q, group, parent, value);
      return {
        suite: await dto.suite(c, d, x, q, row),
        changes: changes(
          parent
            ? (await suites.cases(c, d, x, q, parent)).map((r) => r.content)
            : [],
          value.cases,
        ),
      };
    },
  );
}
function adopt(id, sid, input) {
  return read.mutate(
    id,
    { ...input, _target: sid },
    'verification.suite.adopt',
    async (c, d, x, q) => {
      const row = await repo.required(c, d, x, q, 'test_suites', sid),
        group = await artifacts.group(c, d, x, q);
      const old = q.current_test_suite_id
        ? await repo.required(
            c,
            d,
            x,
            q,
            'test_suites',
            q.current_test_suite_id,
            true,
          )
        : null;
      if (
        input.currentSuiteId !== (old?.public_id || null) ||
        input.baseGroupId !== group?.public_id ||
        row.group_id !== group?.id
      )
        access.fail('TEST_BASELINE_STALE');
      const data = await dto.suite(c, d, x, q, row);
      if (
        row.status !== 'READY' ||
        policy.suite(group, data).status !== 'READY'
      )
        access.fail('TEST_SUITE_INCOMPLETE', 409, '请补齐用例内容及验收项覆盖');
      if (q.stage === 'observe') access.fail('CAPABILITY_UNAVAILABLE');
      if (old?.id !== row.id) {
        if (await read.activeRuns(c, d, x, q))
          access.fail('TEST_HANDOFF_REQUIRED', 409, '先等待或核验当前作业');
        await repo.invalidate(c, d, x, q);
        await suites.adopt(c, d, x, q, row);
      }
      return { suite: data, adopted: true };
    },
  );
}
const get = (id, sid) =>
  read.read(id, async (c, d, x, q) => ({
    suite: await dto.suite(
      c,
      d,
      x,
      q,
      await repo.required(c, d, x, q, 'test_suites', sid),
    ),
  }));
const list = (id, query) =>
  read.read(id, async (c, d, x, q) => {
    const v = await repo.list(c, d, x, q, 'test_suites', query);
    return { ...v, items: v.items.map(dto.summary) };
  });
module.exports = { create, adopt, get, list };
