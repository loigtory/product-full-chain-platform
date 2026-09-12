'use strict';
/* =====================================================================
 * 阶段状态机 + 门控规则（M2a）
 * 服务端强制阶段推进：只允许按序相邻推进；前置阶段需已确认版本；
 * release → observe 需发布成功（审批硬门）。对齐原型 P.advance 语义。
 * ===================================================================== */
const STAGES = ['idea', 'req', 'design', 'dev', 'test', 'accept', 'release', 'observe'];
const NEXT = {
  idea: 'req',
  req: 'design',
  design: 'dev',
  dev: 'test',
  test: 'accept',
  accept: 'release',
  release: 'observe',
};

/* 阶段推进前需要"本阶段已确认版本"的清单（首尾阶段除外） */
const NEED_CONFIRMED = new Set(['idea', 'req', 'design', 'dev', 'test', 'accept', 'release']);

function hasConfirmedVersion(S, reqId, stage) {
  for (const v of S.versions.values()) {
    if (v.reqId === reqId && v.stage === stage && v.confirmedAt) return true;
  }
  return false;
}

function latestRelease(S, reqId) {
  const rels = S.releases
    ? [...S.releases.values()].filter((r) => r.reqId === reqId)
    : [];
  rels.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rels[0] || null;
}

/* 计算推进到 to 的阻塞条件；空数组 = 可推进 */
function blockers(S, req, to) {
  const list = [];
  const expected = NEXT[req.stage];
  if (!expected || to !== expected) {
    list.push(
      '阶段必须按序推进：' + req.stage + ' → ' + (expected || '（已是终态，不可推进）'),
    );
  }
  if (NEED_CONFIRMED.has(req.stage) && !hasConfirmedVersion(S, req.id, req.stage)) {
    list.push(req.stage + ' 阶段需先确认版本（confirm-artifact）后再推进');
  }
  if (req.stage === 'release') {
    const rel = latestRelease(S, req.id);
    if (!rel || rel.status !== 'SUCCEEDED') {
      list.push('发布审批硬门：release → observe 需发布成功（execute 完成）后方可进入');
    }
  }
  return list;
}

module.exports = { STAGES, NEXT, blockers, hasConfirmedVersion, latestRelease };
