'use strict';
const iso = (value) => (value instanceof Date ? value.toISOString() : value);
function req(r) {
  return {
    id: r.public_id,
    name: r.name,
    goal: r.goal,
    scope: r.scope,
    owner: r.owner,
    stage: r.stage,
    revision: r.revision,
    materialRevision: r.material_revision,
    closed: !!r.closed_at,
    projectId: r.project_public_id || null,
    createdAt: iso(r.created_at),
  };
}
function version(v, reqPublicId, comments = []) {
  return {
    id: v.public_id,
    reqId: reqPublicId,
    stage: v.stage,
    version: v.version,
    content: {
      ...v.content,
      confirmed: !!v.confirmed_at,
      review: v.review_state,
      comments,
    },
    confirmedAt: iso(v.confirmed_at),
    confirmedBy: v.confirmed_by,
    stale: v.stale,
    review: v.review_state,
    createdAt: iso(v.created_at),
  };
}
function question(q, reqPublicId) {
  return {
    id: q.public_id,
    reqId: reqPublicId,
    q: q.q,
    answer: q.answer,
    answeredBy: q.answered_by,
    revision: q.revision,
  };
}
function material(m, reqPublicId) {
  return {
    id: m.public_id,
    reqId: reqPublicId,
    name: m.name,
    cls: m.classification,
    classification: m.classification,
    allowed: m.allowed,
    usage: m.usage,
    status: m.status,
    version: m.version,
    content: m.content || '',
    type: m.file_id ? '文件' : '文本',
    hash: m.hash || null,
    size: Number(m.size || 0),
    mimeType: m.mime_type,
    fileReady: !!m.file_id,
    parseStatus:
      m.file_id && !/^text\/|application\/json/.test(m.mime_type)
        ? '原件已保存，尚未解析'
        : '文本预览',
    createdAt: iso(m.created_at),
  };
}
function run(r, reqPublicId, parentPublicId = null) {
  return {
    id: r.public_id,
    reqId: reqPublicId,
    parentId: parentPublicId,
    status: r.status,
    revision: r.revision,
    executionMode: r.execution_mode,
    bridgeId: r.bridge_id,
    bridgeName: r.bridge_name,
    dispatchId: r.dispatch_id,
    step: r.step,
    pct: r.pct,
    exitCode: r.exit_code,
    startedAt: iso(r.started_at),
    createdAt: iso(r.created_at),
    operation: '模拟开发实现',
    budget: null,
    spent: null,
    budgetSource: 'unconfigured',
  };
}
module.exports = { req, version, question, material, run, iso };
