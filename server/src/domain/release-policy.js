'use strict';
const { fail, text } = require('../access');
const limits = Object.freeze({
  plans: 100,
  reviews: 20,
  results: 200,
  events: 2000,
  metrics: 20,
  followups: 50,
  evidence: 20,
  evidenceBytes: 52428800,
  jsonBytes: 524288,
});
function size(v) {
  if (Buffer.byteLength(JSON.stringify(v)) > limits.jsonBytes)
    fail('RELEASE_LIMIT_EXCEEDED', 413, '内容超过512 KiB，请分批提交');
}
function field(v, required = false, max = 4000) {
  return text(v ?? '', max, required);
}
function list(v, max) {
  if (!Array.isArray(v)) fail('INVALID_INPUT', 400, '必须提供列表');
  if (v.length > max) fail('RELEASE_LIMIT_EXCEEDED', 413, '超过条数上限');
  return v;
}
function source(v) {
  if (v !== undefined && v !== 'USER_REPORTED')
    fail('INVALID_RELEASE_SOURCE', 400, '仅支持具名人工登记');
  return 'USER_REPORTED';
}
function unique(v, key) {
  if (new Set(v.map(key)).size !== v.length)
    fail('INVALID_INPUT', 400, '标识不能重复');
  return v;
}
function stable(v) {
  if (
    typeof v !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(v) ||
    ['__proto__', 'constructor', 'prototype'].includes(v)
  )
    fail('INVALID_INPUT', 400, '稳定标识无效');
  return v;
}
function stamp(v, nullable = false) {
  if (nullable && (v === null || v === undefined || v === '')) return null;
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)
  )
    fail('INVALID_INPUT', 400, '时间必须为UTC日期');
  const n = Date.parse(v);
  if (
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 19) !== v.slice(0, 19)
  )
    fail('INVALID_INPUT', 400, '日期无效');
  return new Date(n).toISOString();
}
function evidence(v = [], required = false) {
  const refs = unique(
    list(v, limits.evidence).map((r) => {
      if (!r || !Number.isSafeInteger(r.version) || r.version < 1)
        fail('INVALID_INPUT', 400, '附件版本无效');
      return { id: field(r.id, true, 160), version: r.version };
    }),
    (r) => r.id + ':' + r.version,
  );
  if (required && !refs.length)
    fail('RELEASE_EVIDENCE_UNAVAILABLE', 409, '至少选择一份本需求证据');
  return refs;
}
function plan(input) {
  size(input);
  source(input.source);
  const missingFields = [],
    req = (v, n) => {
      const s = field(v);
      if (!s || /^(待补充|待完善|TODO|待定)$/i.test(s)) missingFields.push(n);
      return s;
    };
  const r = input.rollback || {},
    a = input.authorization || {};
  const content = {
    target: req(input.target, '目标环境'),
    scope: req(input.scope, '发布范围'),
    versionRef: req(input.versionRef, '交付版本'),
    releaseOwner: req(input.releaseOwner, '发布负责人'),
    dependencies: req(input.dependencies, '依赖及影响'),
    risks: req(input.risks, '风险说明'),
    monitoring: req(input.monitoring, '监控来源'),
    alertOwner: req(input.alertOwner, '告警负责人'),
    rollback: {
      target: req(r.target, '回退版本'),
      steps: req(r.steps, '回退步骤'),
      trigger: req(r.trigger, '回退触发条件'),
    },
    hours: input.hours ?? 24,
    smoke: unique(
      list(input.smoke ?? [], 40).map((v) => ({
        checkId: stable(v.checkId),
        title: req(v.title, '冒烟检查项'),
      })),
      (v) => v.checkId,
    ),
    metrics: unique(
      list(input.metrics ?? [], limits.metrics).map((v) => ({
        metricId: stable(v.metricId),
        name: req(v.name, '指标名称'),
        target: req(v.target, '指标目标'),
        unit: req(v.unit, '统计口径/单位'),
        source: req(v.source, '指标来源'),
        sampling: req(v.sampling, '采样说明'),
        owner: req(v.owner, '指标负责人'),
        baseline: field(v.baseline),
      })),
      (v) => v.metricId,
    ),
    authorization: {
      id: req(a.id, '授权编号'),
      target: req(a.target, '授权目标'),
      versionRef: req(a.versionRef, '授权版本'),
      scope: req(a.scope, '授权范围'),
      actor: req(a.actor, '授权责任人'),
      from: stamp(a.from, true),
      until: stamp(a.until, true),
      actions: unique(
        list(a.actions ?? [], 2).map((v) => {
          if (!['DEPLOY', 'ROLLBACK'].includes(v))
            fail('INVALID_INPUT', 400, '授权动作无效');
          return v;
        }),
        (v) => v,
      ),
      evidence: evidence(a.evidence),
    },
    evidence: evidence(input.evidence),
    source: 'USER_REPORTED',
  };
  if (
    !Number.isInteger(content.hours) ||
    content.hours < 1 ||
    content.hours > 168
  )
    fail('INVALID_INPUT', 400, '观察窗口须为1–168小时');
  if (!content.smoke.length) missingFields.push('冒烟清单');
  if (!content.metrics.length) missingFields.push('目标指标');
  if (!content.evidence.length) missingFields.push('准备证据');
  if (!content.authorization.evidence.length) missingFields.push('授权证据');
  if (!a.from || !a.until) missingFields.push('授权有效期');
  else if (Date.parse(a.from) >= Date.parse(a.until))
    fail('INVALID_INPUT', 400, '授权时间区间无效');
  if (
    !content.authorization.actions.includes('DEPLOY') ||
    !content.authorization.actions.includes('ROLLBACK')
  )
    missingFields.push('发布及回退授权声明');
  if (a.target && a.target !== content.target)
    missingFields.push('授权目标不一致');
  if (a.versionRef && a.versionRef !== content.versionRef)
    missingFields.push('授权版本不一致');
  if (a.scope && a.scope !== content.scope)
    missingFields.push('授权范围不一致');
  return {
    content,
    complete: missingFields.length === 0,
    missingFields: [...new Set(missingFields)],
  };
}
function result(input, plan, kind = 'DEPLOY', now = Date.now()) {
  size(input);
  source(input.source);
  if (!['SUCCESS', 'FAILED', 'UNKNOWN'].includes(input.status))
    fail('INVALID_INPUT', 400, '结果无效');
  if (
    input.target !== plan.target ||
    input.versionRef !==
      (kind === 'ROLLBACK' ? plan.rollback.target : plan.versionRef)
  )
    fail('RELEASE_BASELINE_STALE', 409, '实际目标或版本与批准计划不一致');
  const status = input.status,
    startedAt = stamp(input.startedAt),
    endedAt = stamp(input.endedAt, status === 'UNKNOWN'),
    checkedAt = stamp(input.checkedAt ?? new Date(now).toISOString());
  const start = Date.parse(startedAt),
    end = endedAt ? Date.parse(endedAt) : null,
    check = Date.parse(checkedAt);
  if (
    start > now ||
    check > now ||
    check < start ||
    (end !== null && (end < start || end > now || check < end))
  )
    fail('INVALID_INPUT', 400, '实际时间顺序无效或晚于当前时间');
  const auth = plan.authorization;
  if (
    !auth.actions.includes(kind) ||
    start < Date.parse(auth.from) ||
    start > Date.parse(auth.until) ||
    (end !== null && end > Date.parse(auth.until))
  )
    fail('RELEASE_APPROVAL_REQUIRED', 409, '执行时间或动作不在声明授权范围');
  const value = {
    status,
    source: 'USER_REPORTED',
    kind,
    target: input.target,
    versionRef: input.versionRef,
    startedAt,
    endedAt,
    checkedAt,
    actual: field(input.actual, true),
    locator: field(input.locator, status === 'UNKNOWN'),
    responsible: field(input.responsible, status === 'UNKNOWN'),
    evidence: evidence(input.evidence, status !== 'UNKNOWN'),
    smoke: [],
  };
  if (kind === 'DEPLOY') {
    value.smoke = unique(
      list(input.smoke ?? [], 40).map((v) => {
        if (
          !plan.smoke.some((s) => s.checkId === v.checkId) ||
          !['PASS', 'FAIL', 'NOT_RUN'].includes(v.status)
        )
          fail('INVALID_INPUT', 400, '冒烟项无效');
        return {
          checkId: v.checkId,
          status: v.status,
          actual: field(v.actual, v.status !== 'NOT_RUN'),
        };
      }),
      (v) => v.checkId,
    );
    value.smokePassed =
      value.smoke.length === plan.smoke.length &&
      value.smoke.every((v) => v.status === 'PASS');
  }
  return value;
}
function sequence(input, previous) {
  const sequence = input.sequence ?? 1;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence !== (previous?.sequence || 0) + 1 ||
    (input.previousRecordId ?? null) !== (previous?.id || null)
  )
    fail('REVISION_CONFLICT', 409, '前一记录已变化，请核对当前记录后重新提交');
  return { sequence, previousRecordId: previous?.id || null };
}
function entry(input, observation, now = Date.now()) {
  size(input);
  source(input.source);
  const kind = input.kind ?? 'METRIC';
  if (!['METRIC', 'ISSUE'].includes(kind))
    fail('INVALID_INPUT', 400, '观测类型无效');
  const sampledFrom = stamp(input.sampledFrom),
    sampledTo = stamp(input.sampledTo);
  if (
    Date.parse(sampledFrom) < Date.parse(observation.startedAt) ||
    Date.parse(sampledTo) < Date.parse(sampledFrom) ||
    Date.parse(sampledTo) > now
  )
    fail('INVALID_INPUT', 400, '采样时间必须在本发布之后且不晚于当前时间');
  const value = {
    kind,
    source: 'USER_REPORTED',
    sampledFrom,
    sampledTo,
    actual: field(input.actual, true),
    sourceDescription: field(input.sourceDescription, true),
    evidence: evidence(input.evidence, true),
    impact: field(input.impact),
    status: input.status,
  };
  if (kind === 'METRIC') {
    if (
      !observation.plan.metrics.some((v) => v.metricId === input.metricId) ||
      !['MET', 'NOT_MET', 'UNKNOWN'].includes(input.status)
    )
      fail('INVALID_INPUT', 400, '指标或达标状态无效');
    value.metricId = input.metricId;
  } else {
    value.issueId = stable(input.issueId);
    if (!['OPEN', 'RESOLVED'].includes(input.status))
      fail('INVALID_INPUT', 400, '异常状态无效');
    value.responsible = field(input.responsible, true);
  }
  return value;
}
function observationBlockers(o, entries, followups, now = Date.now()) {
  const blockers = [];
  if (Date.parse(o.endsAt) > now) blockers.push('OBSERVATION_WINDOW_OPEN');
  for (const metric of o.plan.metrics) {
    const v = entries.find(
      (e) => e.kind === 'METRIC' && e.metricId === metric.metricId,
    );
    if (
      !v ||
      v.status !== 'MET' ||
      Date.parse(v.sampledTo) < Date.parse(o.endsAt)
    )
      blockers.push('OBSERVATION_INCOMPLETE');
  }
  const issues = new Set();
  for (const e of entries.filter((e) => e.kind === 'ISSUE'))
    if (!issues.has(e.issueId)) {
      issues.add(e.issueId);
      if (e.status !== 'RESOLVED') blockers.push('OBSERVATION_INCOMPLETE');
    }
  if (followups.some((f) => f.blocking && f.status !== 'DONE'))
    blockers.push('OBSERVATION_INCOMPLETE');
  return [...new Set(blockers)];
}
function followup(v) {
  size(v);
  if (typeof v.blocking !== 'boolean')
    fail('INVALID_INPUT', 400, '须明确是否阻断');
  return {
    title: field(v.title, true),
    blocking: v.blocking,
    owner: field(v.owner, true, 160),
    dueAt: stamp(v.dueAt),
    metricId: v.metricId ? stable(v.metricId) : null,
    issueId: v.issueId ? stable(v.issueId) : null,
  };
}
function followupEvent(v) {
  size(v);
  if (!['OPEN', 'IN_PROGRESS', 'DONE'].includes(v.status))
    fail('INVALID_INPUT', 400, '处理状态无效');
  return {
    status: v.status,
    comment: field(v.comment, true),
    owner: field(v.owner, true, 160),
    dueAt: stamp(v.dueAt),
    evidence: evidence(v.evidence, v.status === 'DONE'),
    source: source(v.source),
  };
}
function final(v) {
  size(v);
  if (!['ACCEPTED', 'REJECTED'].includes(v.decision))
    fail('INVALID_INPUT', 400, '验收结论无效');
  const checks = {
    goals: v.checks?.goals === true,
    evidence: v.checks?.evidence === true,
    followups: v.checks?.followups === true,
  };
  if (v.decision === 'ACCEPTED' && Object.values(checks).some((v) => !v))
    fail('INVALID_INPUT', 400, '请完成目标、证据及遗留项核对');
  return {
    decision: v.decision,
    checks,
    actual: field(v.actual, true),
    conclusion: field(v.conclusion, true),
    retrospective: field(v.retrospective, true),
    risks: field(v.risks, true),
    source: source(v.source),
  };
}
// Original bound confirmations only; all semantic validity checks stay live.
function frozenConfirmations(upstream, q, baseline) {
  const matching = (id, kind) =>
    upstream.history.find(
      (r) =>
        r.id === id &&
        r.kind === kind &&
        r.group_id === upstream.group?.id &&
        r.business_epoch === q.artifact_business_epoch &&
        r.input_fingerprint === upstream.inputs.fingerprint,
    );
  const business = matching(baseline.business_confirmation_id, 'BUSINESS'),
    candidate = matching(baseline.design_confirmation_id, 'DESIGN'),
    version = upstream.latest('design');
  const design =
    business &&
    candidate &&
    candidate.design_epoch === q.artifact_design_epoch &&
    candidate.design_version_id === version?.id &&
    !version?.stale &&
    version?.confirmed_at
      ? candidate
      : null;
  return { business, design };
}
module.exports = {
  limits,
  size,
  field,
  list,
  source,
  stamp,
  evidence,
  plan,
  result,
  sequence,
  entry,
  observationBlockers,
  followup,
  followupEvent,
  final,
  frozenConfirmations,
};
