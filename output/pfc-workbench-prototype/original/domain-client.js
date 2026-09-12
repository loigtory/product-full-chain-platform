(() => {
  'use strict';
  const P = window.PFC;
  const api = () => window.PFCAPI.api;
  const D = (P.domain = {});
  D.enabled = () => window.PFCStore?.mode === 'api';
  D.source = (run) => ({
    'bridge-simulation': '模拟 Bridge · 实时协议输出',
    'server-simulation': '服务端模拟 · 无在线 Bridge',
    'bridge-unverified': 'Bridge 输出 · 执行来源待核验',
  })[run?.executionMode] || '领域作业 · 尚未执行';
  const gates = () => ['Lint / 静态检查','单元测试','覆盖率 ≥ 80%','构建','安全扫描']
    .map((name,n) => ({id:['lint','unit','coverage','build','security'][n],name,status:'待执行'}));
  D.merge = (data, select = false) => {
    const raw = data.run, req = P.s.reqs[raw.reqId];
    if (!req) return null;
    let run = req.runs.find(x => x._remote && x.id === raw.id);
    if (!run) {
      run = {id:raw.id,reqId:raw.reqId,_remote:true,lines:[],qualityGates:gates(),replay:[],
        scope:'仅协议模拟；未授权真实工作区操作',snapshot:[],stamp:P.stamp(req),
        git:{repo:req.workspace,branch:'待核验',commit:'待核验',dirty:null},
        files:[],preview:false,scopeId:raw.id+'-scope',budget:8000,spent:0,limit:3,queuePos:1};
      req.runs.push(run);
    }
    if((raw.revision || 0)>=(run.revision || 0)) Object.assign(run,raw,{_remote:true,verified:!['UNKNOWN','CANCELLING'].includes(raw.status)});
    // A GET may finish after a WS line. Preserve any newer numbered tail.
    const tail = run.lines.filter(l => l.seq > (data.lines?.at(-1)?.seq || 0));
    run.lines = [...(data.lines || []), ...tail];
    run.planApproved = data.plan?.approvedAt ? {by:data.plan.approvedBy,at:data.plan.approvedAt,plan:data.plan.plan} : null;
    run.rejectedReason = data.plan?.rejectedReason || null;
    run.replay = (data.replay || []).map(s => ({...s,at:s.stepNo,files:s.snapshotRef ? [s.snapshotRef] : []}));
    run.lease = data.lease || {controller:'Web',deviceId:raw.bridgeId || null,deviceName:raw.bridgeName || '未绑定',state:'unknown'};
    if (data.qualityGates?.length) run.qualityGates = data.qualityGates.map(g => ({id:g.gateId,name:g.name,status:({pass:'通过',fail:'失败'})[g.status] || '待执行',evidenceRef:g.evidenceRef}));
    P.s.seq = Math.max(P.s.seq, Number(raw.id.replace(/^R-/,'')) || 0);
    if (select) { P.s.ui.runId=run.id; P.s.ui.panel='terminal'; }
    return run;
  };
  D.render = () => { P.save(); P.render({quiet:true}); };
  const reading = new Map();
  D.readRun = (id, select = false) => {
    if (reading.has(id)) return reading.get(id);
    const task = api().req('GET','/api/runs/'+encodeURIComponent(id)).then(data => {
      const run = D.merge(data,select); D.render(); return run;
    }).finally(() => reading.delete(id));
    reading.set(id,task); return task;
  };
  D.syncRuns = async () => {
    const {items} = await api().req('GET','/api/runs');
    const found = new Set(items.map(d=>d.run.reqId+':'+d.run.id));
    for (const req of Object.values(P.s.reqs)) for (const run of req.runs) {
      if (run._remote && !found.has(req.id+':'+run.id)) {
        run.status='UNKNOWN';run.verified=false;
        run.recoveryError='服务端记录不可用；内存服务可能已重启，请核对后重新发起';
      }
    }
    items.forEach(data=>D.merge(data)); D.render();
  };
  D.sync = async () => {
    const {items} = await api().req('GET','/api/reqs');
    for (const item of items) {
      const {req: remote} = await api().req('GET','/api/reqs/'+item.id);
      let req = P.s.reqs[item.id];
      if (!req) req=P.s.reqs[item.id]=P.makeRequirement(item.id,item.name,item.goal);
      Object.assign(req,{stage:remote.stage,owner:remote.owner,name:remote.name,goal:remote.goal});
      P.s.seq=Math.max(P.s.seq,Number(item.id.replace(/^R-/,'')) || 0);
      for (const version of remote.versions) {
        if (!req.artifacts[version.stage]) continue;
        const list=req.artifacts[version.stage];
        const local=list.find(v=>v.version===version.version);
        if (version.confirmedAt && local) Object.assign(local,{...version.content,confirmed:true,stale:version.stale,review:'通过',confirmedAt:version.confirmedAt});
        else if (version.confirmedAt && !local) list.push({...version.content,confirmed:true,stale:version.stale,review:'通过'});
      }
    }
    await D.syncRuns();
  };
  D.confirm = async (req,stage,id) => {
    P.write();
    const v=P.latest(req,stage);
    P.assert(v.id===id,'版本已更新，请比较最新内容。');
    P.assert(!req.impact,'先处理材料变更影响。');
    if(stage==='idea') P.assert(req.questions.every(q=>q.answer.trim()),'先回答全部澄清问题。');
    const {version}=await api().req('POST','/api/reqs/'+req.id+'/versions',{stage,content:P.clone(v)});
    await api().req('POST','/api/reqs/'+req.id+'/versions/'+version.id+'/confirm',{});
    P.confirmVersion(req,stage,id); D.render();
  };
  D.advance = async (req) => {
    P.write(); P.current(req);
    P.assert(!P.blockers(req).length,P.blockers(req).join('；'));
    P.assert(P.index(req.stage)<6,'请使用当前阶段的发布或复盘操作。');
    const to=P.D.STAGES[P.index(req.stage)+1].id;
    const {req:remote}=await api().req('PATCH','/api/reqs/'+req.id+'/stage',{to});
    req.stage=remote.stage;P.s.ui.stage=remote.stage;
    P.log(req,'领域阶段推进',remote.stage);D.render();
  };
  let submitting = false;
  D.submitPlan = async (reject = false) => {
    P.assert(!submitting,'正在提交计划，请等待返回');
    P.write();
    const intent=P.domainPlan, req=P.r();
    P.assert(intent?.reqId===req.id && intent.stamp===P.stamp(req),'需求或版本已变化，请重新打开计划');
    P.current(req);
    P.assert(req.stage==='dev' && !req.impact && P.latest(req,'design').confirmed && !P.latest(req,'design').stale,'先确认当前技术方案并进入开发阶段');
    const reason=(P.form()['reject-reason'] || '').trim();
    if (reject) P.assert(reason,'请填写拒绝原因');
    submitting=true;
    try {
      await api().flushNow();
      const created=await api().req('POST','/api/runs',{reqId:req.id,plan:intent.text,commandId:intent.commandId,parentId:intent.parentId});
      D.merge(created,true);D.render();
      if (reject) {
        const result=await api().req('POST','/api/runs/'+created.run.id+'/plan-reject',{reason});
        if(result.audit && !P.s.audit.some(a=>a.id===result.audit.id)) P.s.audit.unshift({...result.audit,time:result.audit.at,req:req.id,stage:req.stage});
        const notices=await api().req('GET','/api/notices');
        for(const n of notices.items) if(!P.s.notices.some(x=>x.id===n.id)) P.s.notices.unshift(n);
      } else {
        if(created.run.status==='WAITING_APPROVAL') await api().req('POST','/api/runs/'+created.run.id+'/plan-approve',{by:P.s.team.name});
        await api().req('POST','/api/runs/'+created.run.id+'/start',{});
      }
      await D.readRun(created.run.id,true);P.close();P.domainPlan=null;
      P.toast(reject?'计划已拒绝，服务端已记录原因':'作业已提交；当前为协议验证路径',reject?'warn':'ok');
    } finally { submitting=false; }
  };
})();
