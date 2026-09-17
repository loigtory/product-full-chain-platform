'use strict';
const path = require('node:path');
const { checkedWorkspace, validatePlan } = require('./exec-control');

// 命令执行已由审批流执行器接管（command-runner）：
//   冻结计划 allowedCommands 精确匹配 + 敏感命令 deny 优先 + 超时进程树终止。
// capability 打开前必须完成 command-runner 的 allowlist/deny/超时单测。
function capability() {
  return {
    supported: true,
    code: 'EXEC_COMMAND_CONTROLLED',
    expectedVersion: '0.154.0',
    reason:
      '命令执行已接入审批流控制：冻结计划 allowlist + 敏感命令 deny + 超时进程树终止',
    hostFiles: 'IMPLEMENTED_PENDING_ACCEPTANCE',
    command: require('./test-runner').commandCapability(),
  };
}
function exactCommand(command, workspace, plan) {
  const frozen = validatePlan({ control: plan });
  const cwd = checkedWorkspace(workspace);
  if (!Array.isArray(command) || command.some((x) => typeof x !== 'string'))
    return false;
  const node = path.resolve(
    __dirname,
    '../../../.tools/node-v24.20.0-win-x64/node.exe',
  );
  const expected = [
    [node, '--test', '--test-reporter=tap'],
    ['git', 'status', '--porcelain=v1'],
    ['git', 'diff', '--no-ext-diff', '--no-textconv'],
  ];
  if (
    !cwd ||
    !expected.some((x) => JSON.stringify(x) === JSON.stringify(command))
  )
    return false;
  return frozen.allowedCommands.some(
    (x) => Array.isArray(x) && JSON.stringify(x) === JSON.stringify(command),
  );
}
function requireCapability() {
  const status = capability();
  if (!status.supported)
    throw Object.assign(new Error(status.reason), { code: status.code });
}
module.exports = { capability, exactCommand, requireCapability };
