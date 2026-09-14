'use strict';
// 受限读（restricted read）：对工作区外目录对 CodexSandboxUsers 组加 deny-read ACE，
// 由 Windows elevated sandbox 强制（45 号第 8.2 节机制已验证：outsideReadDenied=true）。
// 定性结论（9-15 两次探针）：codex 配置层 [permissions.*.filesystem] 的 "none" 在
// Windows elevated 下不转 ACL（profile 加载成功但规则不生效），受限读唯一可靠路径是
// 本模块的 ACL deny hook。
//
// 用法：
//   applyRestrictedRead(dir)  → 对 dir（及子对象，递归+继承）deny CodexSandboxUsers 读
//   removeRestrictedRead(dir) → 移除该 deny（幂等，不存在则静默）
// 非 Windows 平台返回 { skipped: true }（受限读是 Windows elevated 专属能力）。
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SANDBOX_GROUP = 'CodexSandboxUsers';
// (OI)(CI)：继承到子对象与容器；(R)：Read。缺继承标志只拦目录本身、不拦子文件（run2 教训）。
const DENY_RIGHTS = '(OI)(CI)(R)';

function machineQualifiedGroup() {
  const machine = process.env.COMPUTERNAME || '';
  return machine ? `${machine}\\${SANDBOX_GROUP}` : SANDBOX_GROUP;
}

function isWindows() {
  return process.platform === 'win32';
}

// 对单个目录加 deny-read ACE。目录不存在或 icacls 失败抛错（调用方负责回滚）。
function applyRestrictedRead(dir) {
  if (!isWindows()) return { skipped: true, reason: 'restricted-read is Windows-elevated-only' };
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw Object.assign(new Error('RESTRICTED_READ_BAD_DIR'), { code: 'RESTRICTED_READ_BAD_DIR' });
  }
  execFileSync('icacls', [dir, '/deny', `${SANDBOX_GROUP}:${DENY_RIGHTS}`], {
    stdio: 'pipe',
    windowsHide: true,
  });
  return { applied: true, dir };
}

// 移除单目录的 deny-read ACE。幂等：不存在该 deny 时静默成功。
function removeRestrictedRead(dir) {
  if (!isWindows()) return { skipped: true, reason: 'restricted-read is Windows-elevated-only' };
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw Object.assign(new Error('RESTRICTED_READ_BAD_DIR'), { code: 'RESTRICTED_READ_BAD_DIR' });
  }
  try {
    execFileSync('icacls', [dir, '/remove:d', machineQualifiedGroup()], {
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch (e) {
    // /remove:d 在无该 ACE 时返回非零，幂等语义下静默
  }
  return { removed: true, dir };
}

// 批量应用/移除：任一个失败立即抛错（前序已应用的由调用方 finally 清理）。
function applyRestrictedReadAll(dirs) {
  const applied = [];
  try {
    for (const d of dirs) {
      applyRestrictedRead(d);
      applied.push(d);
    }
    return { applied };
  } catch (e) {
    for (const d of applied) {
      try {
        removeRestrictedRead(d);
      } catch (_) {
        /* 尽力回滚 */
      }
    }
    throw e;
  }
}

function removeRestrictedReadAll(dirs) {
  for (const d of dirs) {
    try {
      removeRestrictedRead(d);
    } catch (_) {
      /* 幂等清理，不阻塞 */
    }
  }
  return { removed: dirs };
}

module.exports = {
  SANDBOX_GROUP,
  DENY_RIGHTS,
  applyRestrictedRead,
  removeRestrictedRead,
  applyRestrictedReadAll,
  removeRestrictedReadAll,
  isWindows,
};
