(() => {
  'use strict';
  const W = (window.PFCWS = {});
  let ws = null, timer = null, stopped = false;
  const enabled = () => window.PFCStore?.mode === 'api';
  const find = (m) => Object.values(window.PFC.s.reqs)
    .filter(r=>!m.reqId || r.id===m.reqId)
    .flatMap(r=>r.runs).find(r=>r._remote && r.id===m.runId);
  const render = () => { window.PFC.save(); window.PFC.render({quiet:true}); };
  const recover = () => Promise.resolve(window.PFC.domainView?.pg()?window.PFC.domainView.sync():window.PFC.domain?.syncRuns?.()).catch(e=>{
    window.PFC.toast('作业回读失败：'+e.message,'error');
  });
  const seen=new Set();let refreshPending=false;
  const pgRefresh=()=>{if(refreshPending)return;refreshPending=true;setTimeout(()=>{window.PFC.domainView.sync().catch(e=>window.PFC.toast('服务端回读失败：'+e.message,'error')).finally(()=>refreshPending=false);},120);};
  W.handle = (m) => {
    if(!enabled()) return;
    const P=window.PFC;
    if(P.domainView?.pg()){
      if(m.eventId){if(seen.has(m.eventId))return;seen.add(m.eventId);if(seen.size>1000)seen.delete(seen.values().next().value);}
      if(['req.updated','message.updated','notice'].includes(m.type)){pgRefresh();return;}
      if(m.type==='job.line')m={...m,seq:m.lineSeq};
    }
    if(m.type==='job.line') {
      const run=find(m);
      if(!run) { recover(); return; }
      if(m.seq && run.lines.some(l=>l.seq===m.seq)) return;
      if(m.seq && m.seq>(run.lines.at(-1)?.seq || 0)+1) recover();
      run.lines.push({seq:m.seq,cls:['info','cmd','warn','error','ok'].includes(m.cls)?m.cls:'info',text:String(m.text || '')});
      run.lines.sort((a,b)=>(a.seq || 0)-(b.seq || 0));if(P.domainView?.pg())run.lines=run.lines.slice(-200);render();
    } else if(m.type==='run.status') {
      const run=find(m);
      if(run) {
        if(m.revision && m.revision<(run.revision || 0)) return;
        for(const key of ['status','pct','step','exitCode','revision']) if(m[key]!==undefined) run[key]=m[key];
        run.verified=!['UNKNOWN','CANCELLING'].includes(run.status);render();
      }
      recover();
    } else if(m.type==='notice') {
      if(!m.id || P.s.notices.some(n=>n.id===m.id)) return;
      P.s.notices.unshift({id:m.id,title:m.title,kind:m.kind || 'info',req:m.req,read:false,at:m.at});
      render();P.toast(m.title,m.kind || 'info');
    } else if(m.type==='bridge.status') {
      let bridge=P.s.bridges.find(b=>b.id===m.bridgeId);
      if(!bridge) { bridge={id:m.bridgeId,name:m.name,_remote:true};P.s.bridges.push(bridge); }
      Object.assign(bridge,{status:m.status,name:m.name,_remote:true});render();
    }
  };
  W.connect = () => {
    if(!enabled() || (ws && [0,1].includes(ws.readyState))) return;
    stopped=false;
    const api=window.PFCAPI?.api;
    if(!api?.token()) return;
    const socket=new WebSocket(api.base().replace(/^http/,'ws')+'/ws/web?token='+encodeURIComponent(api.token()));
    ws=socket;
    socket.onopen=()=>{ if(ws===socket) { W.state='connected';recover(); } };
    socket.onmessage=event=>{
      if(ws!==socket || !enabled()) return;
      let message;
      try { message=JSON.parse(String(event.data)); } catch { return; }
      W.handle(message);
    };
    socket.onclose=()=>{
      if(ws!==socket) return;
      ws=null;W.state='disconnected';
      if(!stopped && enabled()) timer=setTimeout(W.connect,1500);
    };
    socket.onerror=()=>{ W.state='disconnected';socket.close(); };
  };
  W.disconnect=()=>{
    stopped=true;clearTimeout(timer);timer=null;
    const socket=ws;ws=null;W.state='disconnected';socket?.close();
  };
})();
