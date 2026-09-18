'use strict';
// 58-A 组：执行链生产级加固验证（源码级断言，无 DB）
// A1 停止/恢复接通真实任务 | A2 预算账本唯一 | A3 验收入口严格化 | A4 EXEC 范围审批
const fs = require('node:fs');
const path = require('node:path');
const server = 'D:\\项目管理\\product-full-chain-platform\\server';
const src = path.join(server, 'src');
const scripts = path.join(server, 'scripts');
const repo = 'D:\\项目管理\\product-full-chain-platform';
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, JSON.stringify(extra)); }
};
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');
const has = (p, rx) => rx.test(read(p));

// ---- A1 停止/恢复 ----
console.log('A1 停止/恢复接通真实任务');
{
  const ws = read('agent/worker.js');
  const cs = read('domain/conversation-service.js');
  t('stopMessage 调 requestCancel', cs.includes("requestCancel("));
  t('stopMessage 提交后调 worker.cancel', cs.includes("require('../agent/worker').cancel("));
  t('worker.cancel 走 control.stop', /async function cancel\([\s\S]{0,400}control\.stop\('TURN_CANCELLED'\)/.test(ws));
  t('cancel 有确认回执(10s 超时)', ws.includes('CANCEL_ACK_TIMEOUT') && ws.includes('confirmed: result.status ==='));
  t('单次超时=300s(文档一致)', ws.includes("300000"));
  t('关闭时终止所有 active control', ws.includes('for (const control of active.values()) await control.stop'));
  const aj = read('persistence/agent-jobs.js');
  t('requestCancel 有实现', aj.includes('async function requestCancel'));
  t('错误映射 TURN_CANCELLED→CANCELLED', read('agent/job-control.js').includes("code === 'TURN_CANCELLED'"));
}

// ---- A2 预算账本唯一 ----
console.log('A2 预算账本统一');
{
  const b = read('agent/budget.js');
  const ledgers = [path.join(repo, '.local/ai-tools-remediation-20260916/budget.json'), path.join(repo, '.local/ai-tools-host-exec-20260917/budget.json')];
  const allExist = ledgers.every((p) => fs.existsSync(p));
  t('权威账本路径固定(根目录 .local)', b.includes("'.local/ai-tools-remediation-20260916/budget.json'") && b.includes("'.local/ai-tools-host-exec-20260917/budget.json'"));
  t('账本路径不依赖启动目录(绝对 repo 推导)', b.includes("path.resolve(__dirname, '../../..')"));
  // server/.local 无独立账本
  const serverLocal = fs.readdirSync(path.join(server, '.local'), { withFileTypes: true }).filter((d) => d.isFile() && /budget.*\.json$/.test(d.name));
  t('server/.local 无独立预算账本', serverLocal.length === 0, serverLocal.map((d) => d.name));
  t('账本格式校验(防双写), attempts 唯一', b.includes('new Set(value.attempts.map((a) => a.attemptId)).size'));
  const host = read('agent/budget.js');
  t('host 账本 80 上限(用户确认)', host.includes('maxTurns: 80'));
}

// ---- A3 验收入口严格化 ----
console.log('A3 验收入口严格化');
{
  const gates = fs.readFileSync(path.join(scripts, 'run-ai-tools-gates.mjs'), 'utf8');
  t('主入口 PLAN_ONLY(不宣称当前通过)', gates.includes("status: 'PLAN_ONLY'"));
  t('currentSourceVerified=false', gates.includes('currentSourceVerified: false'));
  t('EVIDENCE_ONLY 标注非当前运行', gates.includes('Historical evidence is not a current run'));
  t('api 闸带 --pg', gates.includes("args: ['--pg']"));
  t('无 KNOWN_BRANCH_DIFF 一刀切豁免', !gates.includes('KNOWN_BRANCH_DIFF'));
  t('--run 触发 exitCode=2(阻止误执行)', gates.includes('process.exitCode = 2'));
}

// ---- A4 EXEC 范围审批 ----
console.log('A4 EXEC 范围审批');
{
  const ec = read('agent/exec-control.js');
  t('validatePlan: 冻结计划身份(approvalSource/approvedBy/contextHash)', ec.includes('PLAN_IDENTITY_REQUIRED') && ec.includes('approvalSource'));
  t('validatePlan: 模式 strict/readonly + allowedFiles 必填', ec.includes('PLAN_NO_ALLOWED_FILES') && ec.includes("mode !== 'strict' && mode !== 'readonly'"));
  t('validatePlan: allowedCommands 冻结(计划精确匹配)', ec.includes('allowedCommands'));
  t('validatePlan: 过期拒绝(validUntil)', ec.includes('PLAN_EXPIRED'));
  t('freezeForActor: 用户确认 required', ec.includes('PLAN_CONFIRMATION_REQUIRED'));
  t('freezeForActor: 基线 hash 比对', ec.includes('PLAN_BASELINE_CHANGED'));
  t('checkedWorkspace: 命名空间授权 + 无符号链接', ec.includes('WORKSPACE_NOT_AUTHORIZED') && ec.includes('WORKSPACE_LINK_DENIED'));
  t('reviewDiff: 越界检测 + 限制检查', ec.includes('outOfScope') && ec.includes('violates'));
  t('revert: 回滚(ownership journal)', ec.includes('ROLLBACK_OWNERSHIP_REQUIRED') && ec.includes('ROLLBACK_UNVERIFIED'));
  const cs = read('domain/conversation-service.js');
  t('EXEC 作业经 deriveExecControl(54号)', cs.includes('deriveExecControl'));
  t('EXEC 作业经 execution-policy 能力闸', cs.includes('execution-policy').toString() === 'true' && /require\('\.\.\/agent\/execution-policy'\)\.requireCapability/.test(cs));
  const w = read('agent/worker.js');
  t('EXEC 完成校验 tool_executions 全 SUCCEEDED', w.includes('TOOL_EFFECT_UNCONFIRMED'));
  t('EXEC diff 违规拒绝', w.includes('result.fileDiff?.violates'));
}

console.log('\nCONTROLS_VERIFY ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
