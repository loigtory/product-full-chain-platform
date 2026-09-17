'use strict';
const path = require('node:path');
const { checkedWorkspace, validatePlan } = require('./exec-control');

// The installed v2 approval callback exposes optional command text, not a required
// argv vector. on-request also does not attest that every tool reaches the host.
// Do not advertise an execution boundary until an actual protocol probe proves it.
function capability() {
  return {
    supported: false,
    code: 'EXEC_APPROVAL_COVERAGE_UNVERIFIED',
    expectedVersion: '0.154.0',
    reason: '开发执行暂未开放：宿主文件控制已接入，Windows 命令隔离仍待验证',
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
