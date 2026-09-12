import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, runId, root, until, pause, stop } from './m2b2-browser-fixture.mjs';

const evidence=resolve(root,'../../.local/m2b2-acceptance-browser-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(evidence,{recursive:true});
const results=[]; let f;
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); }
  catch(e) { results.push({name,status:'FAIL',error:e.message}); }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  f=await fixture(); const {page,api,click,current}=f;
  await check('page-identity',async()=>{ assert.match(await page.title(),/PFC|产品/); assert.match(await page.locator('#global-header').innerText(),/API/); });
  const reqId=await f.create('main');
  await check('ui-create-confirm-advance-api',async()=>{
    const detail=await api('GET','/api/reqs/'+reqId);
    assert.equal(detail.req.stage,'dev');
    for(const stage of ['idea','req','design']) assert.ok(detail.req.versions.some(v=>v.stage===stage && v.confirmedAt));
    assert.equal(f.requests.filter(r=>r.method==='POST' && r.path==='/api/reqs').length,1);
  });
  const sim=await f.startSim(); const run=await f.start();
  await page.waitForFunction(() => window.PFC.run(window.PFC.r()).lines.length>=2);
  await check('sim-lines-visible-before-completion',async()=>{
    assert.equal((await current()).run.status,'RUNNING');
    for(const id of ['mirror-term','panel-term']) assert.match(await page.locator('#'+id).innerText(),/\[模拟 Bridge\]/);
    await page.screenshot({path:resolve(evidence,'running-1440.png')});
    if (process.env.PFC_E2E_REPAINT === '1') await page.evaluate(() => {
      // Only the synthetic terminal DOM is replaced, reproducing a live-render detach.
      const end = performance.now() + 600;
      const redraw = () => {
        const el = document.querySelector('#mirror-term');
        if (el) el.replaceWith(el.cloneNode(true));
        if (performance.now() < end) requestAnimationFrame(redraw);
      };
      requestAnimationFrame(redraw);
    });
    await page.locator('#mirror-term').evaluate(el => el.scrollIntoView({ block:'nearest', behavior:'instant' }));
    await page.screenshot({path:resolve(evidence,'running-dual-1440.png')});
  });
  await check('execution-source-and-unknown-git-lease',async()=>{
    assert.match(await page.locator('#panel-term').innerText(),/模拟 Bridge · 实时协议输出/);
    const text=await page.locator('#stream').innerText();
    assert.match(text,/工作区待核验/); assert.match(text,/租约未知/);
  });
  await page.waitForFunction(() => window.PFC.run(window.PFC.r()).status==='SUCCEEDED');
  await until(async()=>(await current()).run.replay.length===5,'replay readback');
  await check('succeeded-lines-replay-readback',async()=>{
    const remote=await api('GET','/api/runs/'+run), local=(await current()).run;
    assert.equal(remote.run.status,'SUCCEEDED'); assert.equal(local.exitCode,0);
    assert.equal(remote.lines.length,5); assert.equal(remote.replay.length,5);
    assert.deepEqual(local.lines.map(l=>l.text),remote.lines.map(l=>l.text));
    assert.ok(local.qualityGates.every(g=>g.status==='待执行'));
  });
  await check('remote-success-has-no-simulated-preview-action',async()=>{
    assert.equal(await page.locator('[data-action="preview-toggle"]').count(),0);
  });
  await check('refresh-restores-domain-run',async()=>{
    await page.reload(); await page.waitForFunction(() => window.PFCWS.state==='connected');
    await page.waitForFunction(id=>window.PFC.run(window.PFC.r())?.id===id,run);
    assert.equal((await current()).run.status,'SUCCEEDED');
    assert.equal((await current()).run.lines.length,5);
  });
  await check('three-desktop-widths',async()=>{
    for(const width of [1280,1440,1920]) {
      await page.setViewportSize({width,height:960});
      assert.ok(await page.locator('#panel-term').isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:resolve(evidence,'complete-'+width+'.png')});
    }
    await page.setViewportSize({width:1440,height:960});
  });
  await check('reject-reason-required-and-audited',async()=>{
    const before=(await api('GET','/api/runs')).items.length;
    await click('plan-run'); await click('reject-plan');
    assert.match(await page.locator('#form-error').innerText(),/拒绝原因/);
    assert.equal((await api('GET','/api/runs')).items.length,before);
    await page.locator('[name="reject-reason"]').fill(runId+' 范围需要重新确认');
    await click('reject-plan'); await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    const local=(await current()).run, remote=await api('GET','/api/runs/'+local.id);
    assert.equal(remote.run.status,'FAILED'); assert.match(remote.plan.rejectedReason,/范围需要重新确认/);
    assert.equal(remote.lines.length,0);
    assert.ok(await page.evaluate(()=>window.PFC.s.audit.some(a=>a.action.includes('拒绝'))));
    assert.ok((await api('GET','/api/notices')).items.some(n=>JSON.stringify(n).includes(local.id)));
    await page.screenshot({path:resolve(evidence,'rejected.png')});
  });
  await stop(sim); await until(async()=>(await api('GET','/api/bridges')).items.every(b=>b.status!=='ONLINE'),'sim disconnected');
  await f.create('offline'); await f.start();
  await check('offline-simulation-is-labelled-and-read-back',async()=>{
    const local=(await current()).run, remote=await api('GET','/api/runs/'+local.id);
    assert.equal(local.status,'SUCCEEDED'); assert.equal(local.executionMode,'server-simulation');
    assert.equal(local.lines.length,remote.lines.length); assert.ok(local.lines.length>0);
    assert.match(await page.locator('#panel-term').innerText(),/服务端模拟 · 无在线 Bridge/);
  });
  const controlled=await f.controlledBridge();
  await f.create('long'); const longRun=await f.start(true);
  await until(()=>controlled.jobs.some(m=>m.type==='job.start' && m.runId===longRun),'controlled start');
  await check('duplicate-approval-does-not-create-another-run',async()=>{
    const detail=await api('GET','/api/runs/'+longRun);
    assert.equal((await api('GET','/api/runs')).items.filter(d=>d.run.reqId===detail.run.reqId).length,1);
    assert.equal(controlled.jobs.filter(m=>m.type==='job.start' && m.runId===longRun).length,1);
  });
  await check('long-output-follows-tail-and-preserves-reading',async()=>{
    for(let n=1;n<=45;n++) controlled.send({type:'job.line',runId:longRun,cls:'info',text:runId+' long '+n});
    await page.waitForFunction(()=>window.PFC.run(window.PFC.r()).lines.length===45);
    for(const id of ['mirror-term']) {
      assert.ok(await page.locator('#'+id).evaluate(el=>el.scrollHeight>el.clientHeight));
      assert.ok(await page.locator('#'+id).evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<35));
    }
    assert.ok(await page.locator('.panel-body').evaluate(el=>el.scrollHeight>el.clientHeight));
    assert.ok(await page.locator('.panel-body').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<35), 'right terminal container follows tail');
    await page.locator('#mirror-term').evaluate(el=>{el.scrollTop=0;});
    controlled.send({type:'job.line',runId:longRun,cls:'info',text:runId+' long 46'});
    await page.waitForFunction(()=>window.PFC.run(window.PFC.r()).lines.length===46);
    assert.equal(await page.locator('#mirror-term').evaluate(el=>el.scrollTop),0);
    assert.ok(await page.locator('.panel-body').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<35));
    await page.locator('#mirror-term').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(evidence,'long-output.png')});
  });
  await check('web-reconnect-recovers-missed-lines',async()=>{
    const count=(await api('GET','/api/runs/'+longRun)).lines.length;
    await page.evaluate(()=>window.PFCWS.disconnect());
    controlled.send({type:'job.line',runId:longRun,cls:'info',text:runId+' during disconnect'});
    await until(async()=>(await api('GET','/api/runs/'+longRun)).lines.length===count+1,'missed line stored');
    await page.evaluate(()=>window.PFCWS.connect());
    await page.waitForFunction(count=>window.PFCWS.state==='connected' && window.PFC.run(window.PFC.r()).lines.length===count,count+1);
    assert.match(await page.locator('#panel-term').innerText(),/during disconnect/);
  });
  await check('cancel-waits-for-bridge-ack-and-ignores-late-done',async()=>{
    const revision=(await api('GET','/api/runs/'+longRun)).run.revision;
    await click('run-control','[data-control="cancel"]');
    await until(()=>controlled.jobs.some(m=>m.type==='job.cancel'),'cancel dispatched');
    await page.waitForFunction(()=>window.PFC.run(window.PFC.r()).status==='CANCELLING');
    controlled.send({type:'job.cancelled',runId:longRun});
    await page.waitForFunction(()=>window.PFC.run(window.PFC.r()).status==='CANCELLED');
    controlled.send({type:'job.done',runId:longRun,exitCode:0});
    await pause(150); assert.equal((await api('GET','/api/runs/'+longRun)).run.status,'CANCELLED');
    await page.screenshot({path:resolve(evidence,'cancelled.png')});
    assert.ok((await api('GET','/api/runs/'+longRun)).run.revision>revision, 'cancellation must invalidate older GET snapshots');
  });
  await check('remote-model-controls-never-simulate-state',async()=>{
    const result=await page.evaluate(()=>{
      const P=window.PFC, r=P.r(), run=P.run(r), before=JSON.stringify(run);
      try { P.runControl(r,'verify'); } catch(e) { return {blocked:true,unchanged:JSON.stringify(run)===before}; }
      return {blocked:false};
    });
    assert.deepEqual(result,{blocked:true,unchanged:true});
  });
  await check('bridge-disconnect-stays-unknown-after-verification',async()=>{
    await f.create('disconnect'); const id=await f.start();
    controlled.close();
    await page.waitForFunction(()=>window.PFC.run(window.PFC.r()).status==='UNKNOWN');
    await click('run-control','[data-control="verify"]');
    assert.equal((await api('GET','/api/runs/'+id)).run.status,'UNKNOWN');
    assert.equal((await current()).run.verified,false);
    await page.screenshot({path:resolve(evidence,'unknown.png')});
  });
  await check('readonly-ui-blocks-run-command',async()=>{
    await click('scenarios'); await click('scenario','[data-scenario="viewer"]');
    assert.equal(await page.locator('[data-action="run-control"][data-control="verify"]').isDisabled(),true);
    const before=f.requests.filter(r=>r.method==='POST' && r.path.startsWith('/api/runs')).length;
    const blocked=await page.evaluate(()=>{
      try { window.PFC.actions['plan-run']({}); return false; } catch(e) { return /只读/.test(e.message); }
    });
    assert.equal(blocked,true);
    assert.equal(f.requests.filter(r=>r.method==='POST' && r.path.startsWith('/api/runs')).length,before);
    await click('scenarios'); await click('scenario','[data-scenario="owner"]');
  });
  await check('demo-scenario-cannot-mutate-remote-job',async()=>{
    const before=JSON.stringify((await current()).req.runs);
    await click('scenarios'); await click('scenario','[data-scenario="failed"]');
    assert.equal(JSON.stringify((await current()).req.runs),before);
    assert.match(await page.locator('#form-error').innerText(),/领域作业/);
    await click('close-modal');
  });
  await check('console-health',async()=>assert.deepEqual(f.errors,[]));
} catch(e) {
  results.push({name:'flow-execution',status:'FAIL',error:e.stack});
  if(f) { await f.page.screenshot({path:resolve(evidence,'failure.png')}).catch(()=>{});
    await writeFile(resolve(evidence,'failure-dom.txt'),await f.page.locator('body').innerText().catch(()=>'')); }
} finally {
  const cleanup=f ? await f.close() : {fixtureSetupFailed:true};
  const report={status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',runId,results,cleanup,evidence};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); process.exitCode=report.status==='PASS'?0:1;
}
