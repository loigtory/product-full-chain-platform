// 57 号验收：终端工具执行器（codex_cli READY + 计划内命令批准语义）
// 用法：node verify-57-exec-terminal.cjs
'use strict';
const { resolve } = require('node:path');
const projectRoot = __dirname;
const registry = require(resolve(projectRoot, 'src/agent/host-tools-registry.js'));
const config = require(resolve(projectRoot, 'src/agent/config.js'));
const runner = require(resolve(projectRoot, 'src/agent/command-runner.js'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
};

console.log('A. registry：codex_cli / zed / vscode 均 READY（60 号）');
{
  t('codex_cli READY', registry.statusOf('codex-cli') === 'READY');
  t('zed READY', registry.statusOf('zed') === 'READY');
  t('vscode READY', registry.statusOf('vscode') === 'READY');
  const defs = registry.resolveHostTools(['codex-cli', 'zed', 'vscode']);
  t('codex_cli/zed/vscode 注入=3（60 号）', defs.length === 3 && ['codex_cli', 'zed_terminal', 'vscode_terminal'].every((n) => defs.some((d) => d.name === n)), defs.map((d) => d.name));
  t('codex_cli schema 带 command', defs[0].inputSchema.required[0] === 'command');
}

console.log('B. hostThreadParams 装配（codex_cli 注入后）');
{
  const inventory = { data: [{ skills: [{ path: 'C:/x/SKILL.md' }], errors: [] }] };
  const p = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['codex-cli']);
  t('2 core + codex_cli = 3', p.dynamicTools.length === 3, p.dynamicTools.map((d) => d.name));
  t('codex_cli 在列', p.dynamicTools.some((d) => d.name === 'codex_cli'));
  const p2 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['zed']);
  t('zed 注入=3', p2.dynamicTools.length === 3 && p2.dynamicTools.some((d) => d.name === 'zed_terminal'), p2.dynamicTools.map((d) => d.name));
}

console.log('C. 命令批准语义（assertCommandAllowed，不真实执行）');
{
  const plan = {
    allowedCommands: [
      ['git', 'status', '--porcelain=v1'],
      ['node', '--version'],
    ],
  };
  t('计划内 git status 允许', (() => {
    try { runner.assertCommandAllowed(['git', 'status', '--porcelain=v1'], plan); return true; }
    catch { return false; }
  })());
  t('计划内 node --version 允许', (() => {
    try { runner.assertCommandAllowed(['node', '--version'], plan); return true; }
    catch { return false; }
  })());
  t('计划外命令拒绝', (() => {
    try { runner.assertCommandAllowed(['npm', 'run', 'build'], plan); return false; }
    catch (e) { return e.code === 'COMMAND_NOT_IN_PLAN'; }
  })());
  t('deny 优先：rm 拒绝', (() => {
    const p2 = { allowedCommands: [['rm', '-rf', 'x']] };
    try { runner.assertCommandAllowed(['rm', '-rf', 'x'], p2); return false; }
    catch (e) { return /FORBIDDEN/.test(e.code); }
  })());
  t('deny 优先：git push 拒绝', (() => {
    const p2 = { allowedCommands: [['git', 'push', 'origin', 'main']] };
    try { runner.assertCommandAllowed(['git', 'push', 'origin', 'main'], p2); return false; }
    catch (e) { return e.code === 'COMMAND_GIT_MUTATING_FORBIDDEN'; }
  })());
  t('deny 优先：npm install 拒绝', (() => {
    const p2 = { allowedCommands: [['npm', 'install']] };
    try { runner.assertCommandAllowed(['npm', 'install'], p2); return false; }
    catch (e) { return e.code === 'COMMAND_NPM_NETWORK_FORBIDDEN'; }
  })());
}

console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
