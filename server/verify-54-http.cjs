'use strict';
// 54 号 HTTP 验证：冻结计划派生执行约束（零模型，作业停在 QUEUED）
// 用法：node verify-54-http.cjs <reqA> <wsA> <reqB> <wsB> <reqC> <wsC>
// 断言：
//   A-dev 冻结链：freeze → EXECUTE 派生 STAGE_PLAN（workspace 一致/基线/未过期）
//     → 计划外 workspace → PLAN_WORKSPACE_MISMATCH
//     → 基线漂移 → PLAN_BASELINE_CHANGED
//     → review 通过 + revoke → PLAN_TERMINATED
//   B-dev 无冻结：freezeForActor 兼容路径（approvalSource=SERVER_AUTHENTICATED）
//   C-design 三阶段对齐：design 阶段可发起 EXECUTE（53 号前端对齐）
const { Pool } = require('pg');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ACCESS_KEY = 'Qo-xLAsgQ63Aamynqk7nWwfYfe63f_eZWRKWEYJu8Y0';
const ORIGIN = 'http://127.0.0.1:5188';
const BASE = 'http://127.0.0.1:5188';
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
// 与 exec-control 一致的 workspace 基线哈希（scanWorkspace + baselineHash）
const { scanWorkspace, baselineHash, checkedWorkspace } = require('./src/agent/exec-control');
(async () => {
  const [reqA, wsA, reqB, wsB, reqC, wsC] = process.argv.slice(2);
  if (!reqA || !wsA || !reqB || !wsB || !reqC || !wsC)
    throw new Error('usage: verify-54-http.cjs <reqA> <wsA> <reqB> <wsB> <reqC> <wsC>');

  // 1) 登录
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ key: ACCESS_KEY }),
  });
  check('login 200', login.status === 200, login.status);
  const cookieJar = (login.headers.get('set-cookie') || '').split(';')[0];

  async function api(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: cookieJar,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  }
  async function lastJobControl(publicId) {
    const row = (
      await pool.query(
        `SELECT j.input FROM "${SCHEMA}".agent_jobs j
         JOIN "${SCHEMA}".reqs r ON r.id=j.req_id
         WHERE r.public_id=$1 AND j.kind='EXECUTE' ORDER BY j.created_at DESC LIMIT 1`,
        [publicId],
      )
    ).rows[0];
    return row?.input?.control ?? null;
  }

  const stageControl = {
    mode: 'strict',
    allowedFiles: ['src/**', 'package.json'],
    allowedCommands: [['node', '--version']],
    maxFiles: 5,
    maxBytes: 1048576,
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(),
  };
  let seq = 0;
  async function sendExec(publicId, stage, workspace, extra = {}) {
    seq++;
    const rv = (
      await pool.query(
        `SELECT revision FROM "${SCHEMA}".reqs WHERE public_id=$1`,
        [publicId],
      )
    ).rows[0];
    return api('POST', `/api/reqs/${publicId}/messages`, {
      content: '执行开发任务',
      mode: 'real',
      stage,
      tool: 'exec',
      workspace,
      restrictedReadDirs: [],
      commandId: 'cmd-54-' + seq + '-' + Date.now(),
      expectedRevision: rv?.revision ?? 1,
      ...extra,
    });
  }

  // === A：dev 冻结链 ===
  let r = await api('POST', `/api/agent/requirements/${reqA}/stage-plan/freeze`, {
    stage: 'dev',
    workspace: wsA,
    control: stageControl,
  });
  check('A freeze frozen', r.status === 200 && r.data?.state === 'frozen', { status: r.status, data: r.data });

  // A1：冻结后发起 EXECUTE → control 派生自 STAGE_PLAN
  r = await sendExec(reqA, 'dev', wsA, { control: { confirmed: true } });
  check(
    'A execute 201 + STAGE_PLAN derived',
    r.status === 201 &&
      r.data?.jobId &&
      r.data?.jobKind === 'EXECUTE',
    { status: r.status, data: r.data },
  );
  const ctlA = await lastJobControl(reqA);
  check(
    'A control.approvalSource=STAGE_PLAN',
    ctlA?.approvalSource === 'STAGE_PLAN',
    ctlA,
  );
  check(
    'A control.allowedFiles from frozen plan',
    Array.isArray(ctlA?.allowedFiles) &&
      ctlA.allowedFiles.includes('src/**') &&
      ctlA.allowedFiles.includes('package.json'),
    ctlA?.allowedFiles,
  );
  check(
    'A control.allowedCommands from frozen plan',
    Array.isArray(ctlA?.allowedCommands) &&
      ctlA.allowedCommands.some((c) => c[0] === 'node' && c[1] === '--version'),
    ctlA?.allowedCommands,
  );
  check(
    'A control.validUntil turn-level window',
    ctlA?.validUntil &&
      new Date(ctlA.validUntil).getTime() - Date.now() > 0 &&
      new Date(ctlA.validUntil).getTime() - Date.now() <= 300000,
    ctlA?.validUntil,
  );

  // A2：计划外 workspace → PLAN_WORKSPACE_MISMATCH
  r = await sendExec(reqA, 'dev', wsB, { control: { confirmed: true } });
  check(
    'A workspace mismatch 409',
    r.status === 409 && r.data?.error?.code === 'PLAN_WORKSPACE_MISMATCH',
    { status: r.status, data: r.data },
  );

  // A3：基线漂移 → PLAN_BASELINE_CHANGED
  const drift = path.join(wsA, 'src', 'drift.txt');
  fs.writeFileSync(drift, 'drift\n');
  r = await sendExec(reqA, 'dev', wsA, { control: { confirmed: true } });
  check(
    'A baseline changed 409',
    r.status === 409 && r.data?.error?.code === 'PLAN_BASELINE_CHANGED',
    { status: r.status, data: r.data },
  );
  fs.unlinkSync(drift);

  // A4：review 通过 + revoke → PLAN_TERMINATED
  r = await api('POST', `/api/agent/requirements/${reqA}/stage-plan/review`, { stage: 'dev' });
  check('A review clean', r.status === 200 && r.data?.violates === false, { status: r.status, data: r.data });
  r = await api('POST', `/api/agent/requirements/${reqA}/stage-plan/revoke`, { stage: 'dev' });
  check('A revoke succeeded', r.status === 200 && r.data?.state === 'revoked', { status: r.status, data: r.data });
  r = await sendExec(reqA, 'dev', wsA, { control: { confirmed: true } });
  check(
    'A revoked plan rejected 409',
    r.status === 409 && r.data?.error?.code === 'PLAN_TERMINATED',
    { status: r.status, data: r.data },
  );

  // === B：dev 无冻结 → freezeForActor 兼容（approve 流）===
  const base = checkedWorkspace(wsB);
  const bHash = baselineHash(scanWorkspace(base));
  const turnControl = {
    mode: 'strict',
    allowedFiles: ['src/**', 'package.json'],
    allowedCommands: [['node', '--version']],
    maxFiles: 5,
    maxBytes: 1048576,
    validUntil: new Date(Date.now() + 240000).toISOString(),
    confirmed: true,
    baselineHash: bHash,
  };
  r = await sendExec(reqB, 'dev', wsB, { control: turnControl });
  check(
    'B no-plan fallback 201',
    r.status === 201 && r.data?.jobKind === 'EXECUTE',
    { status: r.status, data: r.data },
  );
  const ctlB = await lastJobControl(reqB);
  check(
    'B control.approvalSource=SERVER_AUTHENTICATED',
    ctlB?.approvalSource === 'SERVER_AUTHENTICATED',
    ctlB,
  );

  // === C：design 阶段三阶段对齐 ===
  r = await api('POST', `/api/agent/requirements/${reqC}/stage-plan/freeze`, {
    stage: 'design',
    workspace: wsC,
    control: { ...stageControl, allowedFiles: ['docs/**', '*.md'] },
  });
  check('C design freeze frozen', r.status === 200 && r.data?.state === 'frozen', { status: r.status, data: r.data });
  r = await sendExec(reqC, 'design', wsC, { control: { confirmed: true } });
  check(
    'C design execute 201 (53 frontend alignment)',
    r.status === 201 && r.data?.jobKind === 'EXECUTE',
    { status: r.status, data: r.data },
  );
  const ctlC = await lastJobControl(reqC);
  check(
    'C design control from stage plan',
    ctlC?.approvalSource === 'STAGE_PLAN' &&
      Array.isArray(ctlC?.allowedFiles) &&
      ctlC.allowedFiles.includes('docs/**'),
    ctlC?.allowedFiles,
  );

  console.log('---');
  console.log('RESULT', pass, 'PASS /', fail, 'FAIL');
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('FAIL', e.code || '', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
