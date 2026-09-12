import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.PFC_DB = 'memory';
process.env.DATABASE_URL = '';
const db = require('./src/db');
const svc = require('./src/domain/service');
const { S } = require('./src/domain/store');
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({name, status:'PASS'}); }
  catch (e) { results.push({name, status:'FAIL', error:e.message}); }
}
// Deterministic process-local factory: collisions, draft/confirmed state, negative paths.
const prefix = 'CODEx_TEST_M2B2_20260912';
await db.saveState({seq:1200, reqs:{'R-1041':{id:'R-1041',name:prefix,stage:'idea',artifacts:{},runs:[{id:'R-101'},{id:'R-102'}]}}});
let req, run;
await check('new requirement cannot overwrite seeded ID', async () => {
  req = (await svc.createReq({name:prefix,goal:'验证模拟作业',scope:'合成数据'})).req;
  assert.notEqual(req.id,'R-1041'); assert.equal(S.reqs.size,2);
});
await check('run ID reserves nested seed IDs', async () => {
  run = (await svc.createRun({reqId:req.id,commandId:prefix+'-approve'})).run;
  assert.ok(!['R-101','R-102'].includes(run.id));
});
await check('retry command returns same pending run', async () => {
  const second = await svc.createRun({reqId:req.id,commandId:prefix+'-approve'});
  assert.equal(second.run.id,run.id);
});
await check('canonical run readback includes plan and terminal', async () => {
  const read = await svc.getRun(run.id); assert.equal(read.run.id,run.id);
  assert.ok(Array.isArray(read.lines)); assert.equal(read.plan.approvedAt,null);
});
await check('whitespace rejection refused without mutation', async () => {
  assert.equal((await svc.planReject(run.id,'   ')).error,'REASON_REQUIRED');
  assert.equal(S.runs.get(run.id).status,'WAITING_APPROVAL');
});
await check('rejected plan cannot be approved or executed', async () => {
  await svc.planReject(run.id,'需补充设计');
  assert.equal((await svc.planApprove(run.id)).error,'INVALID_RUN_STATE');
  assert.equal((await svc.startRun(run.id)).error,'PLAN_NOT_APPROVED');
});
await check('offline simulation readback and repeated start are stable', async () => {
  const r = (await svc.createRun({reqId:req.id})).run;
  await svc.planApprove(r.id); await svc.startRun(r.id);
  const before = JSON.stringify(await svc.getRun(r.id));
  await svc.startRun(r.id);
  assert.equal(JSON.stringify(await svc.getRun(r.id)),before);
  assert.equal(r.exitCode,0); assert.equal(r.executionMode,'server-simulation');
  assert.match(S.lines.get(r.id)[0].text,/模拟/);
});
console.log(JSON.stringify({status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',checks:results.length,results,data:prefix,cleanup:'process-local memory discarded on exit'}));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
