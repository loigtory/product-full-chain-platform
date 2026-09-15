'use strict';
// D5 受控执行（44 号 F 项落地）：计划冻结 + 允许文件清单 + 基线 + 差异审批 + 拒绝回滚。
// 位置：worker.runExecJob 的受控模式（input.control 存在即强制）。
// 边界（如实标注）：命令级拦截依赖 codex 侧 approval_policy（本轮不实现）；
// workspace 外写入依赖 elevated workspace-write 沙箱（已验证 outsideWriteDenied）。
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

// 简单 glob：支持 *（单层）、**（多层）、/ 分隔；返回布尔。
function matchGlob(pattern, rel) {
  const seg = rel.split(/[\\/]+/).filter(Boolean);
  const p = pattern.split('/').filter(Boolean);
  const walk = (pi, si) => {
    if (pi === p.length) return si === seg.length;
    if (p[pi] === '**') {
      for (let k = si; k <= seg.length; k++) if (walk(pi + 1, k)) return true;
      return false;
    }
    if (si === seg.length) return false;
    const rx = new RegExp('^' + p[pi].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*') + '$');
    return rx.test(seg[si]) && walk(pi + 1, si + 1);
  };
  return walk(0, 0);
}

// 计划校验：input.control 存在时冻结执行计划；非法/过期即拒绝（不消耗模型）。
// 返回冻结计划副本；baseline 由调用方在 spawn 前扫描。
function validatePlan(input) {
  const control = input.control;
  if (!control) return null;
  if (typeof control !== 'object' || control === null) fail('PLAN_INVALID');
  const mode = control.mode;
  if (mode !== 'strict' && mode !== 'readonly') fail('PLAN_INVALID_MODE');
  const allowedFiles = Array.isArray(control.allowedFiles) ? control.allowedFiles.map(String) : [];
  if (mode === 'strict' && allowedFiles.length === 0) fail('PLAN_NO_ALLOWED_FILES');
  const forbidden = Array.isArray(control.forbidden) ? control.forbidden.map(String) : [];
  const maxFiles = Number.isSafeInteger(control.maxFiles) ? control.maxFiles : 50;
  const maxBytes = Number.isSafeInteger(control.maxBytes) ? control.maxBytes : 2097152;
  if (control.validUntil) {
    const until = new Date(control.validUntil).getTime();
    if (!Number.isFinite(until)) fail('PLAN_INVALID_UNTIL');
    if (Date.now() > until) fail('PLAN_EXPIRED');
  }
  const frozen = Object.freeze({
    mode,
    allowedFiles: Object.freeze([...allowedFiles]),
    allowedCommands: Object.freeze(
      Array.isArray(control.allowedCommands) ? control.allowedCommands.map(String) : [],
    ),
    forbidden: Object.freeze([...forbidden]),
    maxFiles,
    maxBytes,
    approvedBy: String(control.approvedBy || 'owner'),
    runId: control.runId ? String(control.runId) : null,
    turnId: control.turnId ? String(control.turnId) : null,
    frozenAt: new Date().toISOString(),
  });
  return frozen;
}

// 扫描 workspace 文件树：忽略 .git / node_modules；限制文件数，超出即计划不适用。
// 返回 Map(relPath → { size, sha256, content })。
function scanWorkspace(workspace, maxFiles = 500) {
  const out = new Map();
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.size >= maxFiles) fail('PLAN_BASELINE_TOO_LARGE');
      const full = path.join(dir, e.name);
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        walk(full, relPath);
      } else if (e.isFile()) {
        let content;
        try {
          content = readFileSync(full);
        } catch {
          continue;
        }
        out.set(relPath, {
          size: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          content,
        });
      }
    }
  };
  walk(workspace, '');
  return out;
}

// 差异审批：执行后基线对比。返回 { changes, outOfScope, reasons, violatesLimits }。
function reviewDiff(frozen, workspace, before) {
  const after = scanWorkspace(workspace);
  const changes = [];
  const outOfScope = [];
  const reasons = [];
  for (const [rel, cur] of after) {
    const prev = before.get(rel);
    if (!prev) {
      changes.push({ path: rel, action: 'added' });
      if (!isAllowed(frozen, rel)) outOfScope.push(rel);
    } else if (prev.sha256 !== cur.sha256) {
      changes.push({ path: rel, action: 'modified' });
      if (!isAllowed(frozen, rel)) outOfScope.push(rel);
    }
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) {
      changes.push({ path: rel, action: 'deleted' });
      if (!isAllowed(frozen, rel)) outOfScope.push(rel);
    }
  }
  if (frozen.mode === 'readonly' && changes.length > 0)
    reasons.push('readonly 模式不允许任何工作区改动');
  if (outOfScope.length > 0)
    reasons.push('改动文件超出允许清单: ' + outOfScope.slice(0, 10).join(', '));
  const totalFiles = changes.length;
  const totalBytes = changes.reduce(
    (s, c) => s + (after.get(c.path)?.size ?? before.get(c.path)?.size ?? 0),
    0,
  );
  if (totalFiles > frozen.maxFiles)
    reasons.push(`改动文件数 ${totalFiles} 超过上限 ${frozen.maxFiles}`);
  if (totalBytes > frozen.maxBytes)
    reasons.push(`改动字节数 ${totalBytes} 超过上限 ${frozen.maxBytes}`);
  return {
    changes,
    outOfScope,
    reasons,
    violates: reasons.length > 0,
    totalFiles,
    totalBytes,
  };
}

function isAllowed(frozen, rel) {
  if (frozen.forbidden.some((f) => matchGlob(f, rel))) return false;
  if (frozen.mode === 'readonly') return false;
  return frozen.allowedFiles.some((f) => matchGlob(f, rel));
}

// 拒绝后回滚：把 workspace 还原到基线（写回原内容、删除新增文件）。
function revert(workspace, before) {
  const after = scanWorkspace(workspace);
  const removed = [];
  for (const rel of after.keys()) {
    if (!before.has(rel)) {
      try {
        unlinkSync(path.join(workspace, ...rel.split('/')));
        removed.push(rel);
      } catch {
        /* 忽略 */
      }
    }
  }
  for (const [rel, prev] of before) {
    const full = path.join(workspace, ...rel.split('/'));
    try {
      const cur = readFileSync(full);
      if (cur.length !== prev.content.length || !cur.equals(prev.content)) {
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, prev.content);
      }
    } catch {
      /* 文件已被删除则写回 */
      try {
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, prev.content);
      } catch {
        /* 忽略 */
      }
    }
  }
  return removed;
}

// 命令审计（弱校验，如实标注）：扫描输出流中的命令行痕迹，不在 allowedCommands 时记 warning。
// 命令级拦截依赖 codex 侧 approval_policy，不在此处判定成败。
function auditCommands(allowedCommands, output) {
  if (!allowedCommands || allowedCommands.length === 0) return { warnings: [] };
  const warnings = [];
  const re = /(?:^|\n)\s*>?\s*([a-z0-9_.\\/-]+(?: [^\n]*?))(?=\n|$)/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(output)) && seen.size < 20) {
    const cmd = m[1].trim().slice(0, 120);
    if (!cmd) continue;
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    if (!allowedCommands.some((a) => cmd.startsWith(a)))
      warnings.push('输出中出现允许清单外命令痕迹: ' + cmd);
  }
  return { warnings };
}

module.exports = { validatePlan, scanWorkspace, reviewDiff, revert, auditCommands, matchGlob };
