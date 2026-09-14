import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (p) => readFileSync(resolve(p), 'utf8');
const results = [];
const check = (name, fn) => {
  fn();
  results.push({ name, status: 'PASS' });
};

// 44 号 D7：领域服务处理业务决定、agent 模块处理 provider/进程、仓储处理 SQL。
// 路由与 provider/预算模块不拥有 SQL；worker 属领域侧执行者（其消息写入经
// 事务与租约，是 45 号已验收实现），单独断言其结构与边界。
check('路由与 provider/预算模块不拥有 SQL、不直连领域 store', () => {
  for (const file of [
    'server/src/routes/agent.js',
    'server/src/agent/budget.js',
    'server/src/agent/config.js',
    'server/src/agent/context-service.js',
    'server/src/agent/conversation-provider.js',
  ]) {
    assert.doesNotMatch(
      read(file),
      /INSERT INTO|UPDATE .+ SET|DELETE FROM|CREATE TABLE|CREATE SCHEMA|require\([^)]*domain\/store/,
    );
  }
});

// D7：领域写入与待发作业同一事务；消息、任务、结果分别落库。
check('conversation-service real 分支在事务内入队且返回 jobId', () => {
  const s = read('server/src/domain/conversation-service.js');
  assert.match(s, /input\.mode === 'real'/);
  assert.match(s, /\? \{ real: true \} : \{\}/);
  assert.match(s, /agent-jobs.*\.enqueue/);
  assert.match(s, /realJobId = job\.id/);
  assert.match(s, /jobId: realJobId/);
  // 事务后异步执行 worker，不阻塞请求
  assert.match(s, /\.runTextJob\(\{ db, ctx, reqPublicId: id, jobId: result\.jobId \}\)/);
});

// D7：worker 领取有租约和 owner identity；重启后可重新领取；终态事件正确。
check('worker 事务内 claimById→dispatch，OWNER 固定且终态事件成对', () => {
  const w = read('server/src/agent/worker.js');
  assert.match(w, /jobs\.claimById\(client, db, jobId, OWNER\)/);
  assert.match(w, /jobs\.dispatch\(client, db, jobId, OWNER\)/);
  assert.match(w, /OWNER = '00000000-0000-4000-8000-00000000a111'/);
  assert.match(w, /active\.has\(jobId\)/); // 幂等，不重发
  assert.match(w, /'SUCCEEDED'/);
  assert.match(w, /message\.completed/);
  assert.match(w, /message\.failed/);
  // 失败按 code 落终态
  assert.match(w, /TURN_CANCELLED/);
  assert.match(w, /TURN_TIMED_OUT/);
  // worker 不创建表、不新增 schema、不经 routes
  assert.doesNotMatch(w, /CREATE TABLE|CREATE SCHEMA|require\([^)]*routes\//);
  // 仅实际预留后结算（budgetActive 守卫）
  assert.match(w, /budgetActive/);
});

// 44 号限额：预算账本复用 model-budget.json、文件锁、仅实际预留时结算。
check('budget.js 账本不可重置、文件锁互斥、仅预留后结算', () => {
  const b = read('server/src/agent/budget.js');
  assert.match(b, /model-budget\.json/);
  assert.match(b, /BUDGET_PACKAGE_MISMATCH/);
  assert.match(b, /openSync\(LEDGER \+ '\.lock', 'wx'\)/);
  assert.match(b, /MODEL_TURN_LIMIT/);
  assert.match(b, /MODEL_TIME_LIMIT/);
  assert.match(b, /DISPATCHING/);
  assert.match(b, /settleTurn/);
  assert.match(b, /release\(\)/);
});

// D1：不写凭据；连接参数全部来自 PFC_CODEX_* 环境，授权来自已确认指令源。
check('agent 代码不内嵌 token/apiKey，连接参数来自环境与授权文件', () => {
  for (const file of [
    'server/src/agent/worker.js',
    'server/src/routes/agent.js',
    'server/src/agent/budget.js',
  ]) {
    assert.doesNotMatch(read(file), /PFC_CODEX_TOKEN|apiKey\s*[:=]|sk-[A-Za-z0-9]/);
  }
  const w = read('server/src/agent/worker.js');
  assert.match(w, /process\.env\.PFC_CODEX_BINARY/);
  assert.match(w, /context-exception-confirmation-20260914\.json/);
  const r = read('server/src/routes/agent.js');
  assert.match(r, /USER_CONFIRMED/);
});

// 运行时保持 006 默认、启动不自动迁移（44 号：不换代码连不兼容的库）。
check('runtime 默认 006 且无自动迁移种子', () => {
  const rt = read('server/src/runtime.js');
  assert.match(rt, /PFC_DB_TARGET_VERSION \|\| '006'/);
  assert.doesNotMatch(rt, /CREATE TABLE|INSERT INTO|migrate\(/);
});

// 007 SQL：agent_jobs 终态齐全、messages 增加 durable failed。
check('007 SQL 终态与消息状态契约完整', () => {
  const sql = read('server/sql/m2c/007-ai-tools.sql');
  assert.match(sql, /state text NOT NULL DEFAULT 'QUEUED' CHECK\(state IN \('QUEUED','RUNNING','WAITING_APPROVAL','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN'\)\)/);
  assert.match(sql, /ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK\(status IN \('ok','generating','stopped','interrupted','failed'\)\)/);
});

// 前端 real 模式契约：toggle 仅 PG 显示、开启前查 status、payload 带 mode:'real'。
check('前端 real 模式契约一致', () => {
  const api = read('output/pfc-workbench-prototype/original/api-client.js');
  assert.match(api, /agent: \[/);
  assert.match(api, /\['status', 'GET \/api\/agent\/status'\]/);
  const dc = read('output/pfc-workbench-prototype/original/domain-conversation.js');
  assert.match(dc, /P\.s\.ui\.realMode \? \{ mode: 'real' \}/);
  assert.match(dc, /toggle-real-mode/);
  assert.match(dc, /\/api\/agent\/status/); // 开启前查 capable
  const wb = read('output/pfc-workbench-prototype/original/workbench.js');
  assert.match(wb, /real-toggle/);
  const css = read('output/pfc-workbench-prototype/original/base.css');
  assert.match(css, /\.real-toggle/);
});

// C3 执行闸沙箱参数：workspace-write + elevated + 禁外网 + 无审批。
check('exec-cli 闸沙箱隔离参数固定', () => {
  const v = read('server/verify-ai-tools-exec-cli.mjs');
  assert.match(v, /'-s', 'workspace-write'/);
  assert.match(v, /windows\.sandbox="elevated"/);
  assert.match(v, /sandbox_workspace_write\.network_access=false/);
  assert.match(v, /approval_policy=never/);
  // 外发仅工厂合成 CODEx_TEST_ 前缀
  assert.match(v, /CODEx_TEST_/);
});

console.log(JSON.stringify({ status: 'PASS', results }, null, 2));
