'use strict';
// 审批流驱动的命令执行器（对齐 49 号文档「审批流驱动的执行控制」）
// 安全模型：
//   1. allowlist：命令 argv 必须精确匹配冻结计划的 allowedCommands（数组的数组）
//   2. deny 优先：敏感命令规则先于 allowlist 判定，即使被配置进计划也拒绝
//   3. 工作区限定：cwd 必须是被授权的工作区（checkedWorkspace）
//   4. 超时终止：超时后用 taskkill /T /F 终止整棵进程树
//   5. 审计：stdout/stderr 限量采集 + 命令行痕迹审计
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const { checkedWorkspace, auditCommands } = require('./exec-control');

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const MAX_OUTPUT_BYTES = 1048576; // 每流 1MB 上限

// ---- 敏感命令 deny 规则（argv 数组判定，优先于 allowlist）----
// 命中任一条即拒绝，即使该命令被加入冻结计划。
const DENY_RULES = [
  // git 只读子命令白名单：允许 status/diff/log/show/rev-parse/ls-files/ls-tree/help/version
  {
    test: (a) =>
      a[0] === 'git' &&
      ![
        'status',
        'diff',
        'log',
        'show',
        'rev-parse',
        'ls-files',
        'ls-tree',
        'help',
        'version',
        '--version',
      ].includes(a[1]),
    code: 'COMMAND_GIT_MUTATING_FORBIDDEN',
    reason:
      'git 仅允许只读子命令（status/diff/log/show/rev-parse 等），变更/远端命令需显式授权',
  },
  // 删除类：任何删除命令一律拒绝
  {
    test: (a) =>
      /^(rm|del|rd|rmdir|erase|format|cipher|remove-item)$/i.test(a[0]),
    code: 'COMMAND_DESTRUCTIVE_FORBIDDEN',
    reason: '删除/格式化命令一律拒绝',
  },
  // npm 联网/安装/发布类：拒绝（npm test/run 本地脚本可经 allowlist 放行）
  {
    test: (a) =>
      a[0] === 'npm' &&
      ['install', 'i', 'add', 'update', 'ci', 'publish', 'pack', 'init', 'link', 'exec', 'x', 'create'].includes(
        a[1],
      ),
    code: 'COMMAND_NPM_NETWORK_FORBIDDEN',
    reason: 'npm 安装/联网/发布类命令需显式授权',
  },
  // 任意执行器 / 系统管理 / 网络外发：仅允许 node/git/npm 前缀（按可执行文件名判断）
  {
    test: (a) =>
      !['node', 'node.exe', 'git', 'git.exe', 'npm', 'npm.exe', 'npm.cmd'].includes(
        path.basename(a[0]).toLowerCase(),
      ),
    code: 'COMMAND_GENERAL_EXEC_FORBIDDEN',
    reason: '仅允许冻结计划内的固定命令（node/git/npm），其余执行器一律拒绝',
  },
  // 绝对路径参数：禁止直接访问盘符/UNC/家目录/根路径（工作区内相对路径除外）
  {
    test: (a) =>
      a.slice(1).some(
        (x) =>
          /^[A-Za-z]:[\\/]/.test(x) ||
          /^\\\\/.test(x) ||
          /^~[\\/]/.test(x) ||
          /^[\\/]/.test(x),
      ),
    code: 'COMMAND_ABSOLUTE_PATH_FORBIDDEN',
    reason: '命令参数禁止使用绝对路径，只允许工作区内相对路径',
  },
  // 敏感路径读取：密钥/凭据/环境文件
  {
    test: (a) =>
      a.slice(1).some((x) =>
        /(\.ssh|credentials|\.env(?:[\\/.]|$)|secrets?|tokens?|\.git[\\/]config)(?:[\\/.]|$)/i.test(
          x,
        ),
      ),
    code: 'COMMAND_SENSITIVE_PATH_FORBIDDEN',
    reason: '命令禁止访问密钥/凭据/环境文件',
  },
];

// 校验命令 argv：类型、空、控制字符
function validateCommand(command) {
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((x) => typeof x !== 'string' || /[\r\n\0]/.test(x))
  )
    fail('COMMAND_ARGUMENTS_INVALID');
  if (command.length > 32) fail('COMMAND_TOO_LONG');
}

// deny 检查（返回 null 或 { code, reason }）
function denyMatch(command) {
  for (const rule of DENY_RULES) {
    try {
      if (rule.test(command)) return { code: rule.code, reason: rule.reason };
    } catch {
      /* 规则异常按不命中处理 */
    }
  }
  return null;
}

// allowlist 精确匹配：argv 与冻结计划 allowedCommands 任一条 JSON 相等
function allowlistMatch(command, allowedCommands) {
  const target = JSON.stringify(command);
  return (allowedCommands || []).some(
    (c) => Array.isArray(c) && JSON.stringify(c) === target,
  );
}

// 综合断言：deny 优先 → allowlist。拒绝抛出对应 code。
function assertCommandAllowed(command, plan) {
  validateCommand(command);
  const denied = denyMatch(command);
  if (denied) fail(denied.code);
  if (!allowlistMatch(command, plan?.allowedCommands)) {
    const err = new Error('COMMAND_NOT_IN_PLAN');
    err.code = 'COMMAND_NOT_IN_PLAN';
    throw err;
  }
}

// 终止进程树（Windows taskkill /T /F），失败忽略
function killTree(pid) {
  return new Promise((resolve) => {
    execFile(
      'taskkill',
      ['/pid', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

// 执行命令：
//   command: string[]（argv）
//   cwd: 工作区绝对路径（执行前 checkedWorkspace 校验）
//   plan: 冻结计划（allowedCommands 供 allowlist 匹配与审计）
//   timeoutMs: 超时毫秒（默认 300000，与 worker 一致）
//   onChunk: 可选（63 号终端流）逐块回调 { stream: 'stdout'|'stderr', text }
// 返回 { exitCode, timedOut, stdout, stderr, warnings }
async function runCommand({ command, cwd, plan, timeoutMs = 300000, onChunk }) {
  validateCommand(command);
  const workspace = checkedWorkspace(cwd);
  const denied = denyMatch(command);
  if (denied) fail(denied.code);
  if (!allowlistMatch(command, plan?.allowedCommands)) fail('COMMAND_NOT_IN_PLAN');

  const env = {
    ...process.env,
    // 防止子进程意外外发：显式禁代理
    NO_PROXY: '*',
    no_proxy: '*',
  };
  const child = spawn(command[0], command.slice(1), {
    cwd: workspace,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  child.stdout.on('data', (d) => {
    const text = d.toString('utf8');
    if (onChunk) {
      try {
        onChunk({ stream: 'stdout', text });
      } catch {
        /* 流采集失败不阻断命令 */
      }
    }
    if (stdout.length + d.length > MAX_OUTPUT_BYTES) {
      stdoutTruncated = true;
      stdout += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stdout.length));
      return;
    }
    stdout += text;
  });
  child.stderr.on('data', (d) => {
    const text = d.toString('utf8');
    if (onChunk) {
      try {
        onChunk({ stream: 'stderr', text });
      } catch {
        /* 流采集失败不阻断命令 */
      }
    }
    if (stderr.length + d.length > MAX_OUTPUT_BYTES) {
      stderrTruncated = true;
      stderr += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stderr.length));
      return;
    }
    stderr += text;
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killTree(child.pid);
  }, timeoutMs);

  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    return {
      exitCode: code === null ? 1 : code,
      signal,
      timedOut,
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
      warnings: auditCommands(plan?.allowedCommands, stdout).warnings,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runCommand,
  assertCommandAllowed,
  denyMatch,
  allowlistMatch,
  validateCommand,
  DENY_RULES,
};
