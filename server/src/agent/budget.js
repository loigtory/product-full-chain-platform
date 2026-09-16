'use strict';
// 真实模型调用预算账本：复用 44 号包已建立的 model-budget.json（40 次 turn/start、
// 单次 300 秒、累计 120 分钟；上限由用户 9-15 确认从 20 次/60 分钟扩大，
// 受限读等服务端集成验证必须真实探针，静态/单测无法替代）。
// 并发模型：文件锁互斥，锁只在账本读写的短临界区内持有（reserve/settle 各自
// acquire→读写→释放），并发作业在锁被占用时有限等待后重试，不再 BUDGET_LOCK_HELD 秒败。
// 账本位于被忽略的 .local/ai-tools-integration-20260914/preflight/configs/，不能删除后重置额度。
const {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  mkdirSync,
} = require('node:fs');
const path = require('node:path');
// 账本固定指向项目根 .local（不依赖启动目录，避免 cwd 变化分裂出第二本账本；
// server 目录启动的服务此前曾写入 server/.local 副本，见 45 号 8.11 节合并记录）。
const LEDGER = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.local/ai-tools-integration-20260914/preflight/configs/model-budget.json',
);
// 上限 80 次/单次 300 秒/累计 120 分钟：用户 9-15 多次确认扩大模型预算上限，
// H 常驻验收收口后实读 58/60（剩 2），用户按需确认再扩至 80（9-15 末轮）。
// 开发/验收燃料上限：按需调高（跨阶段全链路验证需 6 次真实调用）。
// 开发/验收燃料上限：按需调高（跨阶段全链路重跑 6 次真实调用 + 余量）。
// 开发/验收燃料上限：按需调高（两轮链式验证累计触顶 108；本轮收口 + 余量）。
// 开发/验收燃料上限：按需调高（链式验证多轮累计 120 触顶；最后一次收口 + 余量）。
// 开发/验收燃料上限：按需调高（EXEC+TEXT 混合链验证 4 次调用 + 余量）。
const MAX_TURNS = 136;
const TURN_SECONDS = 300;
// 累计模型耗时上限：原 7200s（120 分钟）已累计至 6901s 触顶（MODEL_TIME_LIMIT 秒败真因——
// 与作业超时无关）。按用户"按需调高"授权翻倍至 14400s（240 分钟），支撑跨阶段全链路验证。
const MAX_RESERVED_SECONDS = 14400;
const PACKAGE = '44-ai-tools-integration-20260914';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

function load() {
  let budget;
  try {
    budget = JSON.parse(readFileSync(LEDGER, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    budget = { package: PACKAGE, turns: 0, reservedSeconds: 0, attempts: [] };
  }
  if (budget.package !== PACKAGE) fail('BUDGET_PACKAGE_MISMATCH');
  return budget;
}

function save(budget) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(budget, null, 2) + '\n');
}

// 等待获取预算账本文件锁（短临界区互斥）。锁被其他操作持有（EEXIST）时
// 有限等待重试（200ms 间隔，上限 90s），避免并发作业秒败；超时抛 BUDGET_LOCK_HELD。
async function acquire() {
  const deadline = Date.now() + 90000;
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  for (;;) {
    try {
      return openSync(LEDGER + '.lock', 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() >= deadline)
        fail('BUDGET_LOCK_HELD');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function releaseFd(fd) {
  try { closeSync(fd); } catch { /* ignore */ }
  try { unlinkSync(LEDGER + '.lock'); } catch { /* ignore */ }
}

// 预留一次真实 turn。返回当次 attempts 条目；失败时抛出 MODEL_TURN_LIMIT /
// MODEL_TIME_LIMIT / BUDGET_LOCK_HELD（等待超时），不消耗配额。
async function reserveTurn() {
  const fd = await acquire();
  try {
    const budget = load();
    if (!Number.isSafeInteger(budget.turns) || budget.turns < 0)
      fail('BUDGET_INVALID');
    if (budget.turns >= MAX_TURNS) fail('MODEL_TURN_LIMIT');
    if (
      !Number.isFinite(budget.reservedSeconds) ||
      budget.reservedSeconds < 0 ||
      budget.reservedSeconds + TURN_SECONDS > MAX_RESERVED_SECONDS
    )
      fail('MODEL_TIME_LIMIT');
    budget.turns++;
    budget.reservedSeconds += TURN_SECONDS;
    const entry = {
      at: new Date().toISOString(),
      inputHash: null,
      status: 'DISPATCHING',
      reservedSeconds: TURN_SECONDS,
    };
    budget.attempts.push(entry);
    save(budget);
    return entry;
  } finally {
    releaseFd(fd);
  }
}

// 别名：reserveTurn 已内置锁等待重试。
const reserveTurnAsync = reserveTurn;

// 记录当次实际耗时，释放预留额度并写回（短临界区，等待锁）。
async function settleTurn(actualSeconds, state, extra = {}, entryAt) {
  const fd = await acquire();
  try {
    const budget = load();
    const entry = entryAt
      ? budget.attempts.find((e) => e.at === entryAt && e.status === 'DISPATCHING')
      : budget.attempts.find((e) => e.status === 'DISPATCHING');
    if (!entry || entry.status !== 'DISPATCHING') fail('BUDGET_ENTRY_MISSING');
    entry.status = state || 'SUCCEEDED';
    entry.actualSeconds = Math.max(0, Math.ceil(Number(actualSeconds) || 0));
    entry.reservedSeconds = Math.max(
      entry.actualSeconds,
      Math.min(TURN_SECONDS, entry.actualSeconds),
    );
    Object.assign(entry, extra);
    budget.reservedSeconds -= TURN_SECONDS - entry.actualSeconds;
    save(budget);
    return budget;
  } finally {
    releaseFd(fd);
  }
}

// 兼容导出：锁改为短临界区（reserve/settle 各自获取释放），此 no-op 保留旧调用点。
async function release() {}

function snapshot() {
  const budget = load();
  return {
    turns: budget.turns,
    reservedSeconds: budget.reservedSeconds,
    remaining: Math.max(0, MAX_TURNS - budget.turns),
  };
}

module.exports = { reserveTurn, reserveTurnAsync, settleTurn, release, snapshot, LEDGER };
