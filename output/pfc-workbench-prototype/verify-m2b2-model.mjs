import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const store = new Map();
const ctx = vm.createContext({window:{addEventListener(){}}, localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}, Date, console, setTimeout, clearTimeout, URL});
for (const file of ['data.js','model.js','ws-client.js']) vm.runInContext(readFileSync(fileURLToPath(new URL('original/'+file,import.meta.url)),'utf8'),ctx);
const P=ctx.window.PFC;
P.s.reqs={}; P.save=()=>{}; P.render=()=>{};
const r=P.makeRequirement('CODEx_TEST_M2B2_20260912','合成需求','回归','dev');
const run={id:'R-103',reqId:r.id,_remote:true,status:'RUNNING',pct:0,step:0,lines:[],budget:8000};
r.runs=[run];P.s.reqs[r.id]=r;
ctx.window.PFCStore={mode:'api'};
const results=[];
function check(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
check('remote tick does not simulate progress',()=>{P.tick();assert.equal(run.pct,0);assert.equal(run.lines.length,0);});
check('WS finds nested run without cross-requirement writes',()=>{ctx.window.PFCWS.handle({type:'job.line',runId:run.id,reqId:r.id,seq:1,text:'合成行'});assert.equal(run.lines.length,1);ctx.window.PFCWS.handle({type:'job.line',runId:run.id,reqId:'other',seq:2,text:'foreign'});assert.equal(run.lines.length,1);});
check('duplicate event is ignored',()=>{ctx.window.PFCWS.handle({type:'job.line',runId:run.id,reqId:r.id,seq:1,text:'合成行'});assert.equal(run.lines.length,1);});
check('remote status carries exit code',()=>{ctx.window.PFCWS.handle({type:'run.status',runId:run.id,reqId:r.id,status:'SUCCEEDED',exitCode:0,pct:100});assert.equal(run.exitCode,0);assert.equal(run.status,'SUCCEEDED');});
check('older WS status cannot undo cancellation',()=>{
  Object.assign(run,{status:'CANCELLED',revision:3});
  ctx.window.PFCWS.handle({type:'run.status',reqId:r.id,runId:run.id,status:'RUNNING',revision:1});
  assert.equal(run.status,'CANCELLED');assert.equal(run.revision,3);
});
check('remote control cannot enter local verification',()=>{
  P.s.ui.req=r.id;P.s.ui.runId=run.id;
  const before=JSON.stringify(run);
  assert.throws(()=>P.runControl(r,'verify'),/领域作业/);
  assert.equal(JSON.stringify(run),before);
});
console.log(JSON.stringify({status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',checks:results.length,results}));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
