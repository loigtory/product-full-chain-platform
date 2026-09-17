'use strict';
// 51 号前端验证数据（dev 阶段）：造测试需求 + EXECUTE job + PENDING approval
// contextHash 取 stageSnapshot 实际哈希，保证 decide 校验链 AGENT_CONTEXT_CHANGED 通过
const { Pool } = require('pg');
const crypto = require('node:crypto');
const { stageSnapshot } = require('./src/agent/context-service');
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';
const OWNER = '4e40d7a9-ce61-4380-bd2f-1ce1fb46b409';
const db = { schema: SCHEMA, pool };
const ctx = { tenantId: TENANT, role: 'owner', actor: '陈立', memberId: OWNER };
(async () => {
  const now = new Date();
  const reqId = crypto.randomUUID();
  const publicId = 'CODEx_TEST_51_DEV_' + crypto.randomUUID().slice(0, 8).toUpperCase();
  await pool.query(
    `INSERT INTO "${SCHEMA}".reqs
      (id,tenant_id,public_id,name,goal,owner,stage,created_at,updated_at,revision,material_revision,artifact_business_epoch,artifact_design_epoch,verification_epoch,release_epoch)
     VALUES($1,$2,$3,$4,$5,$6,'dev',$7,$7,1,0,0,0,0,0)`,
    [reqId, TENANT, publicId, 'CODEx_TEST 51 审批流验证', '验证计划外命令 PENDING 审批与决策', '陈立', now],
  );
  const reqRow = (
    await pool.query(`SELECT * FROM "${SCHEMA}".reqs WHERE id=$1`, [reqId])
  ).rows[0];
  const snap = await stageSnapshot(pool, db, ctx, reqRow, 'dev');
  const contextHash = snap.hash;
  const inputHash = crypto.createHash('sha256').update('seed-input-51-dev').digest('hex');
  const jobId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const scopeHash = crypto.createHash('sha256').update('git-status-out-of-plan-dev-' + Date.now()).digest('hex');
  await pool.query(
    `INSERT INTO "${SCHEMA}".agent_jobs
      (id,tenant_id,req_id,session_id,command_id,kind,state,input_hash,input,result,owner_id,lease_until,next_sequence,created_by)
     VALUES($1,$2,$3,NULL,$4,'EXECUTE','RUNNING',$5,$6,NULL,$7,now()+'00:01:00',0,$8)`,
    [
      jobId, TENANT, reqId,
      'cmd-51-dev-' + crypto.randomUUID().slice(0, 8),
      inputHash,
      JSON.stringify({
        stage: 'dev',
        contextHash,
        model: 'verify',
        prompt: '验证用计划外命令',
        control: {
          confirmed: true,
          validUntil: new Date(Date.now() + 3600000).toISOString(),
          files: [],
          commands: ['pfc_git_status'],
        },
      }),
      OWNER, OWNER,
    ],
  );
  await pool.query(
    `INSERT INTO "${SCHEMA}".agent_approvals
      (id,tenant_id,req_id,job_id,request_id,thread_id,turn_id,item_id,scope_hash,request,expires_at,state)
     VALUES($1,$2,$3,$4,$5,'t1','tn1','it1',$6,$7,now()+'01:00:00','PENDING')`,
    [
      approvalId, TENANT, reqId, jobId,
      'req-' + crypto.randomUUID().slice(0, 8),
      scopeHash,
      JSON.stringify({
        kind: 'command',
        tool: 'pfc_git_status',
        path: 'git status --short（计划外）',
        contextHash,
        stage: 'dev',
      }),
    ],
  );
  await pool.query(
    `UPDATE "${SCHEMA}".agent_jobs SET next_sequence=next_sequence+1 WHERE id=$1`,
    [jobId],
  );
  await pool.query(
    `INSERT INTO "${SCHEMA}".agent_events(tenant_id,req_id,job_id,sequence,type,payload)
     VALUES($1,$2,$3,1,'approval',$4)`,
    [TENANT, reqId, jobId, JSON.stringify({ approvalId, scopeHash, state: 'PENDING', code: 'COMMAND_NOT_IN_PLAN' })],
  );
  console.log('seeded req', publicId, 'job', jobId.slice(0, 8), 'approval', approvalId.slice(0, 8), 'ctxHash', contextHash.slice(0, 10));
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
