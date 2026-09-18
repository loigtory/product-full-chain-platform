'use strict';
// 62 号验收：预算/资源耗用报表（账本文件为事实源，API 汇总现算一致）
const path = require('node:path');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const REPO = 'D:\\项目管理\\product-full-chain-platform';
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); };

async function main() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', { method: 'POST', headers: H, body: JSON.stringify({ key }) });
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };

  const r = await fetch(BASE + '/api/agent/budget', { headers: auth });
  t('GET /api/agent/budget 200', r.status === 200, r.status);
  const j = await r.json();
  t('双账本结构', !!(j.ledgers?.remediation && j.ledgers?.exec), Object.keys(j.ledgers || {}));
  t('exec 上限 80（用户拍板）', j.ledgers?.exec?.limits?.maxTurns === 80, j.ledgers?.exec?.limits?.maxTurns);
  t('overall 结构', Number.isInteger(j.overall?.turns) && j.overall?.turns >= 0 && Number.isInteger(j.overall?.remainingExecTurns));

  // 独立重算（事实源=账本文件）
  function recompute(ledgerPath) {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    let turns = 0, seconds = 0;
    const byStatus = {};
    for (const a of ledger.attempts) {
      turns++;
      seconds += a.status === 'DISPATCHING' ? a.reservedSeconds : a.actualSeconds;
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    }
    return { turns, seconds, byStatus, attempts: ledger.attempts.length };
  }
  const execRec = recompute(path.join(REPO, '.local', 'ai-tools-host-exec-20260917', 'budget.json'));
  const actRec = recompute(path.join(REPO, '.local', 'ai-tools-remediation-20260916', 'budget.json'));
  t('exec turns 与账本一致', j.ledgers?.exec?.usage?.turns === execRec.turns, { api: j.ledgers?.exec?.usage?.turns, ledger: execRec.turns });
  t('exec seconds 与账本一致', j.ledgers?.exec?.usage?.seconds === execRec.seconds, { api: j.ledgers?.exec?.usage?.seconds, ledger: execRec.seconds });
  t('exec byStatus 与账本一致', JSON.stringify(j.ledgers?.exec?.byStatus) === JSON.stringify(execRec.byStatus), { api: j.ledgers?.exec?.byStatus, ledger: execRec.byStatus });
  t('remediation turns 与账本一致', j.ledgers?.remediation?.usage?.turns === actRec.turns, { api: j.ledgers?.remediation?.usage?.turns, ledger: actRec.turns });
  t('overall.turns = 双账本之和', j.overall?.turns === execRec.turns + actRec.turns, { api: j.overall?.turns, sum: execRec.turns + actRec.turns });
  const hasDay = (j.ledgers?.exec?.byDay || []).length > 0;
  t('byDay 时间序列存在', hasDay, (j.ledgers?.exec?.byDay || []).slice(0, 3));
  t('recent 明细存在', Array.isArray(j.ledgers?.exec?.recent) && j.ledgers?.exec?.recent.every((x) => /^[a-f0-9]{8}…$/.test(x.attemptId)), j.ledgers?.exec?.recent?.[0]);

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  console.log('VERDICT', fail === 0 ? 'PASS' : 'FAIL');
  process.exit(fail ? 3 : 0);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
