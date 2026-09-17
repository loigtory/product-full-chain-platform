'use strict';
const path = require('node:path');
// 命令执行由审批流执行器（command-runner）控制：
//   冻结计划 allowlist 精确匹配 + 敏感命令 deny 优先 + 超时进程树终止。
function commandCapability() {
  return {
    supported: true,
    code: 'EXEC_COMMAND_CONTROLLED',
    reason:
      '命令执行已接入审批流控制：冻结计划 allowlist + 敏感命令 deny + 超时进程树终止',
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
async function runCommand(options) {
  return require('./command-runner').runCommand(options);
}
module.exports = { commandCapability, commandVector, runCommand };
