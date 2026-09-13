'use strict';
const { iso } = require('./dto');
function version(v) {
  return {
    id: v.public_id,
    kind: v.kind,
    version: v.version,
    content: v.content,
    fingerprint: v.fingerprint,
    source: v.source,
    createdAt: iso(v.created_at),
  };
}
function group(g) {
  return g
    ? {
        id: g.public_id,
        version: g.version,
        fingerprint: g.fingerprint,
        inputFingerprint: g.input_fingerprint,
        inputs: g.inputs,
        rules: g.rules,
        prototype: version(g.prototype),
        prd: {
          id: g.prd.public_id,
          version: g.prd.version,
          content: { title: g.prd.content.title, fields: g.prd.content.fields },
        },
        acceptance: version(g.acceptance),
        createdAt: iso(g.created_at),
      }
    : null;
}
function proposal(p, currentId, currentFingerprint) {
  return {
    id: p.public_id,
    state: p.state,
    content: p.payload,
    source: p.source,
    inputs: p.inputs,
    inputFingerprint: p.input_fingerprint,
    baseGroupId: p.base_group_public_id || null,
    resultGroupId: p.result_group_public_id || null,
    stale:
      p.base_group_id !== (currentId || null) ||
      p.input_fingerprint !== currentFingerprint,
    reason: p.reason || '',
    createdAt: iso(p.created_at),
  };
}
function confirmation(c) {
  return c
    ? {
        id: c.public_id,
        kind: c.kind,
        groupId: c.group_public_id,
        memberId: c.member_public_id,
        role: c.role,
        comment: c.comment,
        previewReview: c.preview_review,
        scope: c.scope,
        scopeFingerprint: c.scope_fingerprint,
        createdAt: iso(c.created_at),
      }
    : null;
}
module.exports = { version, group, proposal, confirmation };
