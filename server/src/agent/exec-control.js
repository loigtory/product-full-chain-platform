'use strict';
// Frozen plans and ownership-aware diff recovery. Execution stays disabled until every tool is controlled before execution.
const { createHash } = require('node:crypto');
const {
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} = require('node:fs');
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
    const rx = new RegExp(
      '^' +
        p[pi].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*') +
        '$',
    );
    return rx.test(seg[si]) && walk(pi + 1, si + 1);
  };
  return walk(0, 0);
}

// 计划校验：input.control 存在时冻结执行计划；非法/过期即拒绝（不消耗模型）。
// 返回冻结计划副本；baseline 由调用方在 spawn 前扫描。
// 允许清单语义：用户友好层用 'workspace/**' 表示"工作区内全部"，而 matchGlob 的 rel
// 是相对 workspace 根的路径——归一化剥掉 'workspace/' 前缀段（'workspace/**'→'**'）。
function normalizePattern(p) {
  const seg = String(p).split('/').filter(Boolean);
  if (seg[0] === 'workspace') return seg.slice(1).join('/') || '**';
  return p;
}
function validatePlan(input) {
  const control = input.control;
  if (!control) fail('PLAN_REQUIRED');
  if (
    control.approvalSource !== 'SERVER_AUTHENTICATED' ||
    !/^[a-f0-9-]{36}$/i.test(control.approvedBy || '') ||
    !control.reqId ||
    !/^[a-f0-9]{64}$/.test(control.contextHash || '')
  )
    fail('PLAN_IDENTITY_REQUIRED');
  if (typeof control !== 'object' || control === null) fail('PLAN_INVALID');
  const mode = control.mode;
  if (mode !== 'strict' && mode !== 'readonly') fail('PLAN_INVALID_MODE');
  const allowedFiles = Array.isArray(control.allowedFiles)
    ? control.allowedFiles.map(String).map(normalizePattern)
    : [];
  if (mode === 'strict' && allowedFiles.length === 0)
    fail('PLAN_NO_ALLOWED_FILES');
  const forbidden = Array.isArray(control.forbidden)
    ? control.forbidden.map(String).map(normalizePattern)
    : [];
  const maxFiles = Number.isSafeInteger(control.maxFiles)
    ? control.maxFiles
    : 50;
  if (maxFiles < 1 || maxFiles > 50) fail('PLAN_LIMIT_INVALID');
  const maxBytes = Number.isSafeInteger(control.maxBytes)
    ? control.maxBytes
    : 2097152;
  if (maxBytes < 1 || maxBytes > 5242880) fail('PLAN_LIMIT_INVALID');
  if (!control.validUntil) fail('PLAN_INVALID_UNTIL');
  for (const pattern of [...allowedFiles, ...forbidden])
    if (
      !pattern ||
      path.isAbsolute(pattern) ||
      pattern.split(/[\\/]/).includes('..') ||
      Array.from(pattern).some(
        (char) => char.charCodeAt(0) < 32 || char === ':',
      )
    )
      fail('PLAN_INVALID_PATH');
  if (control.validUntil) {
    const until = new Date(control.validUntil).getTime();
    if (!Number.isFinite(until)) fail('PLAN_INVALID_UNTIL');
    if (until > Date.now() + 300000) fail('PLAN_INVALID_UNTIL');
    if (Date.now() > until) fail('PLAN_EXPIRED');
  }
  const frozen = Object.freeze({
    mode,
    allowedFiles: Object.freeze([...allowedFiles]),
    allowedCommands: Object.freeze(
      Array.isArray(control.allowedCommands)
        ? control.allowedCommands.map((command) => {
            if (
              !Array.isArray(command) ||
              !command.length ||
              command.some(
                (arg) => typeof arg !== 'string' || /[\r\n\0]/.test(arg),
              )
            )
              fail('PLAN_COMMAND_INVALID');
            return Object.freeze([...command]);
          })
        : [],
    ),
    forbidden: Object.freeze([...forbidden]),
    maxFiles,
    maxBytes,
    approvedBy: control.approvedBy,
    approvalSource: control.approvalSource,
    reqId: control.reqId,
    tenantId: control.tenantId,
    contextHash: control.contextHash,
    baselineHash: control.baselineHash,
    validUntil: control.validUntil,
    runId: control.runId ? String(control.runId) : null,
    turnId: control.turnId ? String(control.turnId) : null,
    frozenAt: new Date().toISOString(),
  });
  return frozen;
}

// 扫描 workspace 文件树：忽略 .git / node_modules；限制文件数，超出即计划不适用。
// 返回 Map(relPath → { size, sha256, content })。
function checkedWorkspace(workspace) {
  const full = path.resolve(String(workspace || ''));
  const root = path.resolve(
    __dirname,
    '../../../.local/ai-tools-remediation-20260916',
  );
  const rel = path.relative(root, full).split(path.sep);
  if (
    !/^CODEx_TEST_AI_FIX_20260916_[a-f0-9-]{36}$/.test(rel[0] || '') ||
    rel[1] !== 'workspace' ||
    rel.includes('..') ||
    path.isAbsolute(path.relative(root, full))
  )
    fail('WORKSPACE_NOT_AUTHORIZED');
  let current = path.parse(full).root;
  for (const part of full
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail('WORKSPACE_LINK_DENIED');
  }
  if (
    path.resolve(realpathSync(full)) !== full ||
    !lstatSync(full).isDirectory()
  )
    fail('WORKSPACE_NOT_AUTHORIZED');
  return full;
}
function scanWorkspace(workspace, maxFiles = 50, maxBytes = 5242880) {
  const root = checkedWorkspace(workspace),
    out = new Map();
  let bytes = 0;
  function walk(dir, rel) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name),
        key = rel ? rel + '/' + e.name : e.name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) fail('WORKSPACE_LINK_DENIED');
      if (stat.isDirectory()) {
        if (e.name !== '.git' && e.name !== 'node_modules') walk(full, key);
        continue;
      }
      if (!stat.isFile()) fail('WORKSPACE_FILE_TYPE_DENIED');
      if (out.size >= maxFiles || bytes + stat.size > maxBytes)
        fail('PLAN_BASELINE_TOO_LARGE');
      if (
        /(^|\/)(?:\.env(?:[./]|$)|credentials?|secrets?|tokens?)(?:[./]|$)/i.test(
          key,
        )
      )
        fail('WORKSPACE_SENSITIVE_PATH');
      const content = readFileSync(full);
      bytes += content.length;
      if (bytes > maxBytes) fail('PLAN_BASELINE_TOO_LARGE');
      out.set(key, {
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
      });
    }
  }
  walk(root, '');
  return out;
}
function baselineHash(entries) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...entries]
          .map(([p, v]) => [p, v.sha256])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    )
    .digest('hex');
}
function freezeForActor(input, ctx, req, contextHash) {
  if (ctx.role !== 'owner' || !ctx.memberId) fail('PLAN_IDENTITY_REQUIRED');
  if (input.control?.confirmed !== true) fail('PLAN_CONFIRMATION_REQUIRED');
  const workspace = checkedWorkspace(input.workspace);
  const actual = baselineHash(scanWorkspace(workspace));
  if (input.control.baselineHash !== actual) fail('PLAN_BASELINE_CHANGED');
  return validatePlan({
    control: {
      ...input.control,
      approvalSource: 'SERVER_AUTHENTICATED',
      approvedBy: ctx.memberId,
      tenantId: ctx.tenantId,
      reqId: req.id,
      contextHash,
      baselineHash: actual,
    },
  });
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
function revert(workspace, before, ownedChanges) {
  if (!(ownedChanges instanceof Map)) fail('ROLLBACK_OWNERSHIP_REQUIRED');
  const root = checkedWorkspace(workspace),
    current = scanWorkspace(root);
  // Check the entire ownership journal before changing any file.
  for (const [rel, expected] of ownedChanges) {
    if (
      typeof rel !== 'string' ||
      !rel ||
      rel.includes('\\') ||
      rel.includes(':') ||
      rel.split('/').some((part) => !part || part === '.' || part === '..') ||
      path.isAbsolute(rel)
    )
      fail('PLAN_INVALID_PATH');
    if ((current.get(rel)?.sha256 ?? null) !== expected)
      fail('ROLLBACK_CONFLICT');
  }
  const restored = [];
  for (const [rel] of ownedChanges) {
    if (rel.split('/').includes('..') || path.isAbsolute(rel))
      fail('PLAN_INVALID_PATH');
    const full = path.join(root, ...rel.split('/')),
      prev = before.get(rel);
    if (prev) {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, prev.content);
    } else if (current.has(rel)) unlinkSync(full);
    restored.push(rel);
  }
  const after = scanWorkspace(root);
  for (const rel of restored)
    if ((after.get(rel)?.sha256 ?? null) !== (before.get(rel)?.sha256 ?? null))
      fail('ROLLBACK_UNVERIFIED');
  return restored;
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

module.exports = {
  validatePlan,
  freezeForActor,
  checkedWorkspace,
  baselineHash,
  scanWorkspace,
  reviewDiff,
  revert,
  auditCommands,
  matchGlob,
};
