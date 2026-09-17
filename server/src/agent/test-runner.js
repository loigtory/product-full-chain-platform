'use strict';
const path = require('node:path');
// v0.154.0 CommandExecParams exposes readOnly/workspaceWrite without a read
// allowlist. No actual Windows read/write/network mechanism is established for
// this task. Refuse before RPC; never substitute an unsandboxed process API.
function commandCapability() {
  return {
    supported: false,
    code: 'HOST_COMMAND_SANDBOX_UNVERIFIED',
    reason: '当前 Windows 命令沙箱尚未证明工作区外读取和网络访问受限',
  };
}
function commandVector(id) {
  const commands = {
    'node-test': [
      path.resolve(__dirname, '../../../.tools/node-v24.20.0-win-x64/node.exe'),
      '--test',
      '--test-reporter=tap',
    ],
    'git-status': ['git', 'status', '--porcelain=v1'],
    'git-diff': ['git', 'diff', '--no-ext-diff', '--no-textconv'],
  };
  if (!Object.hasOwn(commands, id))
    throw Object.assign(new Error('HOST_COMMAND_INVALID'), {
      code: 'HOST_COMMAND_INVALID',
    });
  return commands[id];
}
async function runCommand() {
  const c = commandCapability();
  throw Object.assign(new Error(c.reason), { code: c.code });
}
module.exports = { commandCapability, commandVector, runCommand };
