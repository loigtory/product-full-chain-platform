'use strict';
const { fail, text } = require('../access');
const limits = Object.freeze({
  cases: 200,
  steps: 40,
  batchWrite: 100,
  caseHistory: 100,
  results: 2000,
  evidence: 20,
  evidenceBytes: 52428800,
  jsonBytes: 524288,
  openBatches: 5,
});
function size(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > limits.jsonBytes)
    fail('VERIFICATION_LIMIT_EXCEEDED', 413, '内容超过512 KiB，请分批提交');
}
function list(value, max, field) {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 400, field + '必须是列表');
  if (value.length > max)
    fail('VERIFICATION_LIMIT_EXCEEDED', 413, field + '超出数量上限');
  return value;
}
function field(value, name, required = false) {
  name =
    {
      title: '标题',
      scenario: '场景',
      preconditions: '前置条件',
      expected: '预期结果',
      dataPolicy: '数据策略',
      owner: '负责人',
      devVersionId: '开发版本',
      versionRef: '提交或构建引用',
      changes: '变更摘要',
      implementation: '实施说明',
      rollback: '回滚方式',
      unimplemented: '未实现范围',
    }[name] || name;
  try {
    return text(value ?? '', 4000, required);
  } catch (e) {
    e.message = name + '不能为空或超过4000字符';
    throw e;
  }
}
function ids(value, allowed, name) {
  const values = list(value ?? [], 100, name).map((x) => text(x, 160, true));
  if (
    new Set(values).size !== values.length ||
    values.some((x) => !allowed.has(x))
  )
    fail('INVALID_TEST_REFERENCE', 400, name + '必须引用当前关联组且不能重复');
  return values;
}
function suite(group, input) {
  size(input);
  if (!group)
    fail('ARTIFACT_CONFIRMATION_REQUIRED', 409, '先采纳关联原型、PRD与验收项');
  const acs = group.acceptance.content.items;
  const acIds = new Set(acs.map((x) => x.acId)),
    ruleIds = new Set(group.rules.map((x) => x.ruleId));
  const raw =
    input.fromAcceptance === true
      ? acs.map((a, i) => ({
          caseId: 'CASE-' + (i + 1),
          acIds: [a.acId],
          ruleIds: a.ruleId ? [a.ruleId] : [],
          title: a.scenario,
          scenario: a.scenario,
          preconditions: a.precondition,
          steps: a.steps,
          expected: a.expected,
          dataPolicy: '',
          executionMode: 'USER_REPORTED',
          owner: '',
        }))
      : input.cases;
  const gaps = [],
    seen = new Set();
  const cases = list(raw, limits.cases, '用例').map((v, i) => {
    if (!v || typeof v !== 'object') fail('INVALID_INPUT', 400);
    const c = {
      caseId: text(v.caseId, 160, true),
      acIds: ids(v.acIds, acIds, '验收项'),
      ruleIds: ids(v.ruleIds, ruleIds, '规则'),
    };
    if (seen.has(c.caseId))
      fail('DUPLICATE_TEST_CASE', 400, '用例编号不能重复');
    seen.add(c.caseId);
    for (const name of [
      'title',
      'scenario',
      'preconditions',
      'expected',
      'dataPolicy',
      'owner',
    ]) {
      c[name] = field(v[name], name);
      if (!c[name]) gaps.push(c.caseId + '：待补' + name);
    }
    c.steps = list(v.steps ?? [], limits.steps, '步骤').map((x) =>
      field(x, '步骤'),
    );
    if (!c.steps.length || c.steps.some((x) => !x))
      gaps.push(c.caseId + '：待补操作步骤');
    c.executionMode = v.executionMode || 'USER_REPORTED';
    if (c.executionMode !== 'USER_REPORTED')
      fail('INVALID_TEST_SOURCE', 400, '本版仅登记具名人工结果');
    if (!c.acIds.length) gaps.push(c.caseId + '：待关联验收项');
    if (input.fromAcceptance) gaps.push('用例' + (i + 1) + '：待补边界与数据');
    return c;
  });
  const covered = new Set(cases.flatMap((x) => x.acIds));
  for (const id of acIds)
    if (!covered.has(id)) gaps.push('未覆盖验收项：' + id);
  if (!cases.length || !acs.length) gaps.push('至少需要一个验收项和用例');
  return {
    groupId: group.public_id,
    title: field(input.title || '测试套件', '套件名称', true),
    status: gaps.length ? 'INCOMPLETE' : 'READY',
    cases,
    gaps,
  };
}
function evidence(value, required = true) {
  const refs = list(value ?? [], limits.evidence, '证据').map((r) => {
    if (!r || !Number.isInteger(r.version) || r.version < 1)
      fail('INVALID_INPUT', 400, '证据版本无效');
    return { id: text(r.id, 160, true), version: r.version };
  });
  if (new Set(refs.map((r) => r.id)).size !== refs.length)
    fail('INVALID_INPUT', 400, '证据不能重复');
  if (required && !refs.length)
    fail('VERIFICATION_EVIDENCE_UNAVAILABLE', 409, '请关联实际结果的附件证据');
  return refs;
}
function result(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    fail('INVALID_INPUT', 400, '结果必须为对象');
  size(v);
  if (v.source !== 'USER_REPORTED')
    fail('INVALID_TEST_SOURCE', 400, '不能将模拟或未核实来源登记为已执行');
  if (!['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(v.status))
    fail('INVALID_INPUT', 400, '测试状态无效');
  if (
    !Number.isInteger(v.sequence) ||
    v.sequence < 1 ||
    v.sequence > limits.caseHistory
  )
    fail('VERIFICATION_LIMIT_EXCEEDED', 400, '结果序号超出范围');
  const executedAt = new Date(v.executedAt);
  if (
    typeof v.executedAt !== 'string' ||
    !Number.isFinite(executedAt.getTime()) ||
    executedAt.getTime() > Date.now() + 300000
  )
    fail('INVALID_INPUT', 400, '实际执行时间无效');
  const executed = ['PASS', 'FAIL'].includes(v.status);
  return {
    caseId: text(v.caseId, 160, true),
    status: v.status,
    sequence: v.sequence,
    previousResultId:
      v.previousResultId == null ? null : text(v.previousResultId, 160, true),
    source: 'USER_REPORTED',
    actual: field(v.actual, '实际结果', executed),
    reason: field(v.reason, '未完成原因', !executed),
    executedAt: executedAt.toISOString(),
    evidence: evidence(v.evidence, executed),
  };
}
function complete(cases, results, defects) {
  if (
    !cases.length ||
    cases.some(
      (c) =>
        !results.some((r) => r.case_id === c.caseId && r.status === 'PASS'),
    )
  )
    fail('TEST_RESULT_REQUIRED', 409, '当前批次全部必测用例通过后才能完成测试');
  if (defects.some((d) => d.state !== 'CLOSED'))
    fail('DEFECT_RETEST_REQUIRED', 409, '仍有未关闭缺陷，请完成新版本回归');
  return true;
}
function acceptance(v) {
  if (!['ACCEPTED', 'REJECTED'].includes(v.decision))
    fail('PRODUCT_ACCEPTANCE_REQUIRED', 400, '只允许通过或驳回');
  const checks = {};
  for (const key of ['functionality', 'exceptions', 'evidence']) {
    checks[key] = v.checks?.[key] === true;
    if (v.decision === 'ACCEPTED' && !checks[key])
      fail(
        'PRODUCT_ACCEPTANCE_REQUIRED',
        409,
        '请确认功能、异常和版本证据三项检查',
      );
  }
  return {
    decision: v.decision,
    checks,
    comment: field(v.comment, '验收结论', true),
    risks: field(v.risks, '风险说明', true),
  };
}
function delivery(v) {
  size(v);
  const out = {};
  for (const key of [
    'devVersionId',
    'versionRef',
    'changes',
    'implementation',
    'rollback',
    'unimplemented',
  ])
    out[key] = field(v[key], key, true);
  if (Object.values(out).some((x) => /^(待补充|TODO|TBD)$/i.test(x)))
    fail('TEST_HANDOFF_REQUIRED', 409, '交付内容尚未补齐');
  out.evidence = evidence(v.evidence);
  out.runId =
    v.runId == null || v.runId === '' ? null : text(v.runId, 160, true);
  out.referenceVerification = 'USER_DECLARED';
  return out;
}
module.exports = {
  limits,
  size,
  list,
  field,
  suite,
  evidence,
  result,
  complete,
  acceptance,
  delivery,
};
