import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const policy = require('./src/domain/verification-policy');
const root = new URL(
  '../docs/quality-gate/reports/r3-test-acceptance-20260913/testing/',
  import.meta.url,
);
const group = {
  public_id: 'AG-CODEx_TEST_1',
  acceptance: {
    content: {
      items: [
        {
          acId: 'AC1',
          ruleId: 'RULE1',
          scenario: '必填校验',
          precondition: '打开页面',
          steps: ['留空保存'],
          expected: '提示必填',
        },
      ],
    },
  },
  rules: [{ ruleId: 'RULE1' }],
};
const caseData = () => ({
  caseId: 'CASE1',
  acIds: ['AC1'],
  ruleIds: ['RULE1'],
  title: '名称必填',
  scenario: '必填校验',
  preconditions: '打开页面',
  steps: ['留空保存'],
  expected: '提示必填',
  dataPolicy: 'CODEx_TEST_合成空名称',
  executionMode: 'USER_REPORTED',
  owner: 'CODEx_TEST_executor',
});
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
  }
}
const code = (fn, expected) => assert.throws(fn, (e) => e.code === expected);
await test('提前准备为待补边界草稿，不伪造READY或测试结果', () => {
  const s = policy.suite(group, { fromAcceptance: true });
  assert.equal(s.status, 'INCOMPLETE');
  assert.deepEqual(s.cases[0].acIds, ['AC1']);
  assert.ok(s.gaps.length);
  assert.equal(s.cases[0].expected, '提示必填');
});
await test('READY要求完整字段与当前全部AC覆盖', () => {
  const s = policy.suite(group, { cases: [caseData()] });
  assert.equal(s.status, 'READY');
  assert.equal(
    policy.suite(group, { cases: [{ ...caseData(), dataPolicy: '' }] }).status,
    'INCOMPLETE',
  );
  assert.equal(policy.suite(group, { cases: [] }).status, 'INCOMPLETE');
  code(
    () => policy.suite(group, { cases: [{ ...caseData(), acIds: ['OTHER'] }] }),
    'INVALID_TEST_REFERENCE',
  );
});
await test('重复ID、201用例和超长输入失败，200用例允许', () => {
  code(
    () => policy.suite(group, { cases: [caseData(), caseData()] }),
    'DUPLICATE_TEST_CASE',
  );
  const cases = Array.from({ length: 200 }, (_, i) => ({
    ...caseData(),
    caseId: 'CASE' + i,
  }));
  assert.equal(policy.suite(group, { cases }).cases.length, 200);
  code(
    () =>
      policy.suite(group, {
        cases: [...cases, { ...caseData(), caseId: 'OVER' }],
      }),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
  code(
    () =>
      policy.suite(group, {
        cases: [{ ...caseData(), expected: 'a'.repeat(4001) }],
      }),
    'INVALID_INPUT',
  );
});
const result = () => ({
  caseId: 'CASE1',
  status: 'PASS',
  sequence: 1,
  previousResultId: null,
  source: 'USER_REPORTED',
  actual: '名称为空时提示必填',
  executedAt: '2026-09-13T01:00:00Z',
  evidence: [{ id: 'M-CODEx_TEST_1', version: 1 }],
});
await test('人工PASS需要实际结果与附件，模拟或伪造执行来源拒绝', () => {
  assert.equal(policy.result(result()).source, 'USER_REPORTED');
  code(
    () => policy.result({ ...result(), source: 'CI_VERIFIED' }),
    'INVALID_TEST_SOURCE',
  );
  code(
    () => policy.result({ ...result(), evidence: [] }),
    'VERIFICATION_EVIDENCE_UNAVAILABLE',
  );
  code(() => policy.result({ ...result(), actual: '' }), 'INVALID_INPUT');
  code(
    () => policy.result({ ...result(), executedAt: 'bad' }),
    'INVALID_INPUT',
  );
});
await test('未执行/阻塞必须原因，不能改变为PASS', () => {
  code(
    () => policy.result({ ...result(), status: 'BLOCKED', reason: '' }),
    'INVALID_INPUT',
  );
  assert.equal(
    policy.result({
      ...result(),
      status: 'NOT_RUN',
      reason: '等待合成环境',
      evidence: [],
    }).status,
    'NOT_RUN',
  );
});
await test('批次出口不允许空、失败、未测或未关闭缺陷', () => {
  const cases = [caseData()];
  code(() => policy.complete([], [], []), 'TEST_RESULT_REQUIRED');
  code(() => policy.complete(cases, [], []), 'TEST_RESULT_REQUIRED');
  code(
    () => policy.complete(cases, [{ case_id: 'CASE1', status: 'FAIL' }], []),
    'TEST_RESULT_REQUIRED',
  );
  code(
    () =>
      policy.complete(
        cases,
        [{ case_id: 'CASE1', status: 'PASS' }],
        [{ state: 'OPEN' }],
      ),
    'DEFECT_RETEST_REQUIRED',
  );
  assert.equal(
    policy.complete(cases, [{ case_id: 'CASE1', status: 'PASS' }], []),
    true,
  );
});
await test('产品验收三项检查及风险必填，无条件通过', () => {
  const good = {
    decision: 'ACCEPTED',
    checks: { functionality: true, exceptions: true, evidence: true },
    comment: 'CODEx_TEST_完成检查',
    risks: '无',
  };
  assert.equal(policy.acceptance(good).decision, 'ACCEPTED');
  code(
    () =>
      policy.acceptance({
        ...good,
        checks: { ...good.checks, exceptions: false },
      }),
    'PRODUCT_ACCEPTANCE_REQUIRED',
  );
  code(
    () => policy.acceptance({ ...good, decision: 'CONDITIONAL' }),
    'PRODUCT_ACCEPTANCE_REQUIRED',
  );
});

await test('步骤、批量、证据及历史边界', () => {
  const good = caseData();
  assert.equal(
    policy.suite(group, {
      cases: [{ ...good, steps: Array(40).fill('CODEx_TEST_步骤') }],
    }).status,
    'READY',
  );
  code(
    () =>
      policy.suite(group, {
        cases: [{ ...good, steps: Array(41).fill('CODEx_TEST_步骤') }],
      }),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
  assert.equal(policy.list(Array(100).fill(result()), 100, '结果').length, 100);
  code(
    () => policy.list(Array(101).fill(result()), 100, '结果'),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
  assert.equal(
    policy.result({
      ...result(),
      sequence: 100,
      previousResultId: 'CODEx_TEST_previous',
    }).sequence,
    100,
  );
  code(
    () => policy.result({ ...result(), sequence: 101 }),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
  const refs = Array.from({ length: 20 }, (_, i) => ({
    id: 'CODEx_TEST_' + i,
    version: 1,
  }));
  assert.equal(policy.evidence(refs).length, 20);
  code(
    () => policy.evidence([...refs, { id: 'CODEx_TEST_over', version: 1 }]),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
  code(
    () => policy.evidence([{ id: 'CODEx_TEST_1', version: 0 }]),
    'INVALID_INPUT',
  );
  code(() => policy.result(null), 'INVALID_INPUT');
  code(
    () => policy.size({ data: 'a'.repeat(524288) }),
    'VERIFICATION_LIMIT_EXCEEDED',
  );
});
await test('未执行、阻塞、已重开缺陷及未确认检查均不能放行', () => {
  for (const status of ['NOT_RUN', 'BLOCKED'])
    code(
      () => policy.complete([caseData()], [{ case_id: 'CASE1', status }], []),
      'TEST_RESULT_REQUIRED',
    );
  for (const state of ['RESOLVED', 'REOPEN'])
    code(
      () =>
        policy.complete(
          [caseData()],
          [{ case_id: 'CASE1', status: 'PASS' }],
          [{ state }],
        ),
      'DEFECT_RETEST_REQUIRED',
    );
  code(
    () => policy.acceptance({ decision: 'REJECTED', comment: '', risks: '无' }),
    'INVALID_INPUT',
  );
});
mkdirSync(root, { recursive: true });
writeFileSync(
  new URL('model.json', root),
  JSON.stringify(
    {
      status: results.every((x) => x.status === 'PASS') ? 'PASS' : 'FAIL',
      data: 'process-local CODEx_TEST_ deterministic, no external calls',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ results }, null, 2));
if (results.some((x) => x.status !== 'PASS')) process.exitCode = 1;
