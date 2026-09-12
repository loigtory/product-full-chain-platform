import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

export const root = dirname(fileURLToPath(import.meta.url));
export const runId = 'CODEx_TEST_M2B2_20260912';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(80); }
  throw Error('Timeout: ' + label);
}
export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill(); await exited;
}
export async function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
export async function fixture() {
  const port = 5194, base = 'http://127.0.0.1:' + port;
  if (!await portFree(port)) throw Error('Test port already occupied: ' + port);
  let browser, context, page, token, sim, bridge;
  const children = [], requests = [], errors = [], createdIds = [];
  const startChild = (args, extra = {}) => {
    const child = spawn(process.execPath, args, {
      cwd: resolve(root, '../../server'), windowsHide: true,
      env: {...process.env, PORT: String(port), PFC_DB: 'memory', DATABASE_URL: '', JWT_SECRET: randomUUID(), ...extra},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child); child.stdout.resume(); child.stderr.resume(); return child;
  };
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {method, signal: AbortSignal.timeout(10000),
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
      body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw Error(method + ' ' + path + ': ' + res.status + ' ' + data.error?.code);
    return data;
  };
  const close = async () => {
    bridge?.close(); await browser?.close();
    for (const child of children.toReversed()) await stop(child);
    return {children: children.map(c => ({pid:c.pid, exited:c.exitCode !== null || c.signalCode !== null})),
      port, portFree: await portFree(port), contextsClosed:true, data:'memory discarded', createdIds};
  };
  try {
    const server = startChild(['src/index.js']);
    await until(async () => { try { return (await fetch(base + '/api/health', {signal:AbortSignal.timeout(1000)})).ok; } catch { return false; } }, 'server health');
    browser = await chromium.launch({channel:'msedge', headless:true, timeout:30000});
    context = await browser.newContext({viewport:{width:1440,height:960}});
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.addInitScript(base => { window.PFC_DATA_MODE='api'; window.PFC_API_BASE=base; }, base);
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    page.on('request', r => { if(r.url().startsWith(base+'/api/')) requests.push({method:r.method(),path:new URL(r.url()).pathname}); });
    await page.goto(pathToFileURL(resolve(root,'index.html')).href, {waitUntil:'load',timeout:30000});
    await page.waitForFunction(() => window.PFCWS?.state==='connected' && window.PFC?.domain);
    token = await page.evaluate(() => localStorage.getItem('pfc.prototype.token'));
    const click = (action, extra='') => page.locator('button[data-action="'+action+'"]'+extra).first().click();
    const current = () => page.evaluate(() => ({req:window.PFC.r(),run:window.PFC.run(window.PFC.r())}));
    const create = async (suffix) => {
      // Deterministic valid UI data; no direct injection of business state.
      await click('navigate','[data-route="home"]');
      await click('new-requirement');
      for(const [key,value] of Object.entries({name:runId+'_'+suffix,goal:'验证合成提醒需求的审批与实时输出',scope:'仅内存协议测试；无真实文件操作',owner:runId}))
        await page.locator('[name="'+key+'"]').fill(value);
      await click('create-requirement');
      await page.waitForFunction(name => window.PFC.r()?.name===name, runId+'_'+suffix);
      const id=(await current()).req.id; createdIds.push(id);
      for(const [qid,answer] of [['q1','仅合成用户；消息提醒协议验证'],['q2','失败保留记录；取消等待回执；仅断言模拟数据']]) {
        await click('answer-question','[data-id="'+qid+'"]');
        await page.locator('[name="answer"]').fill(answer); await click('save-answer');
      }
      for(const [stage,next] of [['idea','req'],['req','design'],['design','dev']]) {
        await click('confirm-artifact','[data-stage="'+stage+'"]');
        await page.waitForFunction(st => window.PFC.latest(window.PFC.r(),st).confirmed,stage);
        await click('advance');
        await page.waitForFunction(st => window.PFC.r().stage===st,next);
      }
      return id;
    };
    const start = async (double = false) => {
      await click('plan-run');
      if (double) await page.locator('[data-action="start-run"]').evaluate(el => { el.click(); el.click(); });
      else await click('start-run');
      await page.waitForFunction(() => window.PFC.run(window.PFC.r())?._remote && !document.querySelector('[role="dialog"]'));
      return (await current()).run.id;
    };
    const startSim = async () => {
      const pair = await api('POST','/api/bridges/pair',{name:runId+'_sim'});
      sim=startChild(['sim-bridge.mjs','--port',String(port),'--name',runId+'_sim'],{PFC_BRIDGE_TOKEN:pair.bridgeToken});
      await until(async () => (await api('GET','/api/bridges')).items.some(b=>b.id===pair.bridgeId && b.status==='ONLINE'),'sim bridge');
      return sim;
    };
    const controlledBridge = async () => {
      const pair = await api('POST','/api/bridges/pair',{name:runId+'_controlled'});
      bridge=new WebSocket(base.replace('http:','ws:')+'/ws/bridge?token='+encodeURIComponent(pair.bridgeToken));
      const jobs=[]; bridge.onmessage=e=>jobs.push(JSON.parse(String(e.data)));
      await once(bridge,'open'); bridge.send(JSON.stringify({type:'bridge.hello',simulated:true}));
      const send=m=>bridge.send(JSON.stringify(m));
      return {jobs,send,close:()=>bridge.close(),id:pair.bridgeId};
    };
    return {page,context,api,click,current,create,start,startSim,controlledBridge,close,requests,errors,server,base};
  } catch(e) { await close(); throw e; }
}
