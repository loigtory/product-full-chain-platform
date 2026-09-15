'use strict';
// 真实模型调用预算账本：复用 44 号包已建立的 model-budget.json（40 次 turn/start、
// 单次 300 秒、累计 120 分钟；上限由用户 9-15 确认从 20 次/60 分钟扩大，
// 受限读等服务端集成验证必须真实探针，静态/单测无法替代）。文件锁保证并发调用互斥；
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
const MAX_TURNS = 90;
const TURN_SECONDS = 300;
const MAX_RESERVED_SECONDS = 7200;
const PACKAGE = '44-ai-tools-integration-20260914';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
let lockFd = null;

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

// 预留一次真实 turn。返回当次 attempts 条目；失败时抛出 MODEL_TURN_LIMIT /
// MODEL_TIME_LIMIT，不消耗配额。调用方必须在 settleTurn 或 release 中结算。
function reserveTurn() {
  if (lockFd !== null) fail('BUDGET_LOCK_HELD');
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  lockFd = openSync(LEDGER + '.lock', 'wx');
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
  } catch (e) {
    release();
    throw e;
  }
}

// 记录当次实际耗时，释放预留额度并写回。
function settleTurn(actualSeconds, state, extra = {}) {
  if (lockFd === null) fail('BUDGET_LOCK_HELD');
  try {
    const budget = load();
    const entry = budget.attempts.at(-1);
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
    release();
  }
}

function release() {
  if (lockFd !== null) {
    try {
      closeSync(lockFd);
      unlinkSync(LEDGER + '.lock');
    } catch {
      /* 锁文件已释放即视为成功 */
    }
    lockFd = null;
  }
}

function snapshot() {
  const budget = load();
  return {
    turns: budget.turns,
    reservedSeconds: budget.reservedSeconds,
    remaining: Math.max(0, MAX_TURNS - budget.turns),
  };
}

module.exports = { reserveTurn, settleTurn, release, snapshot, LEDGER };
