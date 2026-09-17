'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '../../..');
const LEDGER = path.join(
  repo,
  '.local/ai-tools-remediation-20260916/budget.json',
);
const LEGACY = path.join(
  repo,
  '.local/ai-tools-integration-20260914/preflight/configs/model-budget.json',
);
const HOST_LEDGER = path.join(
  repo,
  '.local/ai-tools-host-exec-20260917/budget.json',
);
const fault = (code) => Object.assign(new Error(code), { code });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createBudget({
  ledger = LEDGER,
  maxTurns = 8,
  maxSeconds = 2400,
  packageId = '46-ai-tools-remediation-20260916',
  maxConcurrency = Infinity,
} = {}) {
  const full = path.resolve(ledger);
  const host = packageId === '48-ai-tools-host-exec-20260917';
  if (host) maxConcurrency = 1;
  const hostRoot = path.join(repo, '.local/ai-tools-host-exec-20260917');
  const hostRelative = path.relative(hostRoot, full);
  const hostFixture =
    packageId === 'unit-fixture' &&
    maxTurns === 2 &&
    maxSeconds === 600 &&
    /[/\\]unit-budget[/\\]budget\.json$/.test(full) &&
    !hostRelative.startsWith('..') &&
    !path.isAbsolute(hostRelative);
  const allowedRoot = path.join(
    repo,
    host || hostFixture
      ? '.local/ai-tools-host-exec-20260917'
      : '.local/ai-tools-remediation-20260916',
  );
  const rel = path.relative(allowedRoot, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
    throw fault('BUDGET_TARGET_INVALID');
  function load() {
    require('../local/profile').noLinks(full);
    if (!fs.existsSync(full))
      return { format: 2, packageId, attempts: [], maxTurns, maxSeconds };
    const value = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (
      value.format !== 2 ||
      value.packageId !== packageId ||
      value.maxTurns !== maxTurns ||
      value.maxSeconds !== maxSeconds ||
      !Array.isArray(value.attempts) ||
      new Set(value.attempts.map((a) => a.attemptId)).size !==
        value.attempts.length
    )
      throw fault('BUDGET_LEDGER_INVALID');
    if (
      value.attempts.some(
        (a) =>
          !/^[a-f0-9-]{36}$/.test(a.attemptId || '') ||
          ![
            'DISPATCHING',
            'SUCCEEDED',
            'FAILED',
            'CANCELLED',
            'TIMED_OUT',
            'UNKNOWN',
          ].includes(a.status) ||
          (a.status !== 'DISPATCHING' &&
            (!Number.isInteger(a.actualSeconds) ||
              a.actualSeconds < 0 ||
              a.actualSeconds > 300)),
      )
    )
      throw fault('BUDGET_LEDGER_INVALID');
    return value;
  }
  function totals(b) {
    return {
      turns: b.attempts.length,
      reservedSeconds: b.attempts.reduce(
        (n, a) => n + (a.status === 'DISPATCHING' ? 300 : a.actualSeconds),
        0,
      ),
    };
  }
  async function locked(fn) {
    require('../local/profile').noLinks(full);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    let fd;
    const start = Date.now();
    while (fd === undefined) {
      try {
        fd = fs.openSync(full + '.lock', 'wx');
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() - start >= 10000) throw fault('BUDGET_LOCK_HELD');
        await delay(25);
      }
    }
    try {
      return await fn();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(full + '.lock');
    }
  }
  function save(b) {
    const temp = full + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(
        temp,
        JSON.stringify({ ...b, ...totals(b) }, null, 2) + '\n',
        { flag: 'wx' },
      );
      fs.renameSync(temp, full);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  async function reserveTurn() {
    return locked(() => {
      const b = load(),
        total = totals(b);
      if (
        b.attempts.filter((a) => a.status === 'DISPATCHING').length >=
        maxConcurrency
      )
        throw fault('MODEL_CONCURRENCY_LIMIT');
      if (total.turns >= maxTurns) throw fault('MODEL_TURN_LIMIT');
      if (total.reservedSeconds + 300 > maxSeconds)
        throw fault('MODEL_TIME_LIMIT');
      if (!b.legacy && fs.existsSync(LEGACY)) {
        const bytes = fs.readFileSync(LEGACY),
          old = JSON.parse(bytes);
        b.legacy = {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          turns: old.turns,
          attempts: old.attempts?.length,
          reservedSeconds: old.reservedSeconds,
        };
      }
      const entry = {
        attemptId: randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'DISPATCHING',
        reservedSeconds: 300,
      };
      b.attempts.push(entry);
      save(b);
      return { ...entry, at: entry.attemptId };
    });
  }
  async function settleTurn(seconds, status, details = {}, attemptId) {
    return locked(() => {
      if (
        !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'].includes(
          status,
        ) ||
        !Number.isFinite(seconds) ||
        seconds < 0
      )
        throw fault('BUDGET_SETTLEMENT_INVALID');
      const b = load(),
        a = b.attempts.find((x) => x.attemptId === attemptId);
      if (!a) throw fault('BUDGET_ENTRY_MISSING');
      if (a.status !== 'DISPATCHING') {
        if (a.status !== status) throw fault('BUDGET_ALREADY_SETTLED');
        return a;
      }
      Object.assign(a, {
        status,
        actualSeconds:
          status === 'UNKNOWN' ? 300 : Math.min(300, Math.ceil(seconds)),
        settledAt: new Date().toISOString(),
        details: {
          ...(details.inputHash ? { inputHash: details.inputHash } : {}),
        },
      });
      save(b);
      return a;
    });
  }
  function snapshot() {
    const b = load(),
      total = totals(b);
    return {
      ...total,
      maxTurns,
      maxSeconds,
      remaining: Math.max(0, maxTurns - total.turns),
      packageId,
      unresolved: b.attempts.filter((a) => a.status === 'DISPATCHING').length,
    };
  }
  return {
    reserveTurn,
    reserveTurnAsync: reserveTurn,
    settleTurn,
    snapshot,
    release() {},
  };
}
const active = createBudget();
module.exports = {
  ...active,
  LEDGER,
  HOST_LEDGER,
  createBudget,
  hostBudget: () =>
    createBudget({
      ledger: HOST_LEDGER,
      packageId: '48-ai-tools-host-exec-20260917',
      maxConcurrency: 1,
      maxTurns: 80,
      maxSeconds: 24000,
    }),
};
