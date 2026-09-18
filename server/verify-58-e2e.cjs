'use strict';
// 58-C 端到端闭环：真实需求 → 回答澄清 → 阶段推进到 dev → EXEC 真实作业（计划内命令）→ worker 执行 → 消息回写
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:5188';
const H = { origin: BASE, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = 'D:\\项目管理\\product-full-chain-platform';

async function main() {
  const key = fs.readFileSync(path.join(REPO, '.local', 'pfc-workbench', 'access-key.txt'), 'utf8').trim();
  const login = await fetch(BASE + '/api/auth/local-session', {
    method: 'POST', headers: H, body: JSON.stringify({ key }),
  });
  console.log('login', login.status);
  if (login.status !== 200) throw new Error('LOGIN_FAILED ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { ...H, cookie };
  let gid = null;
  const getDetail = async (id) => {
    const r = await fetch(BASE + '/api/reqs/' + id, { headers: auth });
    const j = await r.json();
    return j.req || j.requirement;
  };

  // 1. 创建需求
  const stamp = Date.now().toString().slice(-6);
  const reqName = 'CODEx_TEST_58_E2E_' + stamp;
  const cr = await fetch(BASE + '/api/reqs', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: reqName, goal: '58 端到端：验证 PM 从想法到上线全链路闭环中的 dev 阶段 EXEC 受控执行真实可用。', scope: '58 e2e', commandId: '58-e2e-create-' + Date.now().toString(36) }),
  });
  const crj = await cr.json();
  if (cr.status !== 201) throw new Error('CREATE_FAILED ' + JSON.stringify(crj).slice(0, 300));
  const reqId = crj.req.id;
  console.log('created', reqName, 'stage=' + crj.req.stage);

  // 2. 回答全部澄清问题（每个回答前重取 revision）
  let d = await getDetail(reqId);
  for (const q of d.questions || []) {
    const a = await fetch(BASE + '/api/reqs/' + reqId + '/questions/' + q.id + '/answer', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ answer: '已确认：面向 PM 的全链路闭环平台，chat 为主交互，阶段能力可热插拔。', expectedRevision: d.revision, commandId: '58-e2e-ans-' + q.id + '-' + Date.now().toString(36) }),
    });
    console.log('answer', q.id, a.status);
    d = await getDetail(reqId);
  }

  // 3. 阶段推进 idea→req（确认版本后推进）
  d = await getDetail(reqId);
  {
    const v = [...(d.versions || [])].reverse().find((x) => x.stage === d.stage);
    if (v) {
      await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (v.id || v.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '58-e2e-cf-idea-' + Date.now().toString(36) }),
      });
      d = await getDetail(reqId);
    }
  }
  {
    const r = await fetch(BASE + '/api/reqs/' + reqId + '/stage', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ to: 'req', expectedRevision: d.revision, commandId: '58-e2e-stage-req-' + Date.now().toString(36) }),
    });
    const j = await r.json();
    console.log('advance→req', r.status, 'stage=' + j.req?.stage);
    if (r.status !== 200 || j.req?.stage !== 'req') throw new Error('STAGE_ADVANCE_BLOCKED at req: ' + JSON.stringify(j).slice(0, 200));
    d = j.req;
  }

  // 4. req 阶段：确认 req 版本 → proposal → adopt → confirm-business（自动推进到 design）
  d = await getDetail(reqId);
  {
    const rv = [...(d.versions || [])].reverse().find((x) => x.stage === 'req');
    if (rv) {
      const c = await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (rv.id || rv.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '58-e2e-cf-req-' + Date.now().toString(36) }),
      });
      console.log('confirm req version', c.status);
      d = await getDetail(reqId);
    }
    const wsr = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-workspace', { headers: auth });
    const wsj = await wsr.json();
    const fp = wsj.inputFingerprint;
    const prop = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ inputMode: 'template', templateId: 'form-table', params: {}, baseGroupId: null, inputFingerprint: fp, expectedRevision: wsj.revision, commandId: '58-e2e-prop-' + Date.now().toString(36) }),
    });
    const propj = await prop.json();
    console.log('createProposal', prop.status, 'pid=' + (propj.proposal?.id || propj.proposal?.public_id), JSON.stringify(propj).slice(0, 150));
    const pid = (propj.proposal?.id || propj.proposal?.public_id || propj.proposalId);
    if (!pid) throw new Error('PROPOSAL_FAILED ' + JSON.stringify(propj).slice(0, 300));
    d = await getDetail(reqId);
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-proposals/' + pid + '/adopt', {
      method: 'POST', headers: auth, body: JSON.stringify({ baselineGroupId: null, inputFingerprint: fp, expectedRevision: d.revision, commandId: '58-e2e-adopt-' + Date.now().toString(36) }),
    });
    const adj = await ad.json();
    gid = adj.group?.id || adj.group?.public_id || adj.proposal?.groupId || (adj.artifactGroup && (adj.artifactGroup.id || adj.artifactGroup.public_id));
    console.log('adopt', ad.status, 'gid=' + gid, JSON.stringify(adj).slice(0, 150));
    if (!gid) throw new Error('ADOPT_FAILED ' + JSON.stringify(adj).slice(0, 300));
    d = await getDetail(reqId);
    const cb = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-business', {
      method: 'POST', headers: auth, body: JSON.stringify({ comment: '业务方案已确认（58 端到端）', advanceTo: 'design', inputFingerprint: fp, expectedRevision: d.revision, commandId: '58-e2e-cb-' + Date.now().toString(36) }),
    });
    console.log('confirmBusiness', cb.status, 'nextStage=' + (await cb.json()).nextStage);
    d = await getDetail(reqId);
    console.log('after confirmBusiness stage=' + d.stage);
  }

  // 5. design 阶段：确认 design 版本 → confirm-design（自动推进到 dev）
  {
    const dv = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    if (dv) {
      const c = await fetch(BASE + '/api/reqs/' + reqId + '/versions/' + (dv.id || dv.public_id) + '/confirm', {
        method: 'POST', headers: auth, body: JSON.stringify({ expectedRevision: d.revision, commandId: '58-e2e-cf-design-' + Date.now().toString(36) }),
      });
      console.log('confirm design version', c.status);
      d = await getDetail(reqId);
    }
    const dv2 = [...(d.versions || [])].reverse().find((x) => x.stage === 'design');
    const ad = await fetch(BASE + '/api/reqs/' + reqId + '/artifact-groups/' + gid + '/confirm-design', {
      method: 'POST', headers: auth, body: JSON.stringify({ comment: '实施设计已确认（58 端到端）', advanceTo: 'dev', designVersionId: dv2?.id || dv2?.public_id, scope: { goal: '完成计划内命令验证', files: 'workspace/**', validation: 'node --version', exit: '记录执行结果', rollback: 'git revert', capabilityIds: [] }, expectedRevision: d.revision, commandId: '58-e2e-cd-' + Date.now().toString(36) }),
    });
    const adj = await ad.json();
    console.log('confirmDesign', ad.status, 'nextStage=' + adj.nextStage, JSON.stringify(adj).slice(0, 120));
    if (ad.status !== 200) throw new Error('CONFIRM_DESIGN_FAILED ' + JSON.stringify(adj).slice(0, 300));
    d = await getDetail(reqId);
    console.log('after confirmDesign stage=' + d.stage);
    if (d.stage !== 'dev') throw new Error('NOT_IN_DEV ' + d.stage);
  }

  // 4. 准备授权工作区 + 基线
  const wsRoot = path.join(REPO, '.local', 'ai-tools-remediation-20260916', 'CODEx_TEST_AI_FIX_20260916_' + randomUUID());
  const ws = path.join(wsRoot, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'sample.txt'), '58 e2e workspace\n', { flag: 'wx' });
  const execControl = require(path.join(REPO, 'server', 'src', 'agent', 'exec-control.js'));
  const entries = execControl.scanWorkspace(ws);
  const baseline = execControl.baselineHash(entries);
  console.log('workspace ready', ws, 'files=' + entries.size, 'baseline=' + baseline.slice(0, 12));

  // 5. 发 EXEC 真实作业（confirmed control + 计划内命令）
  const control = {
    confirmed: true,
    mode: 'strict',
    allowedFiles: ['**'],
    allowedCommands: [['git', 'status', '--short'], ['node', '--version']],
    maxFiles: 50,
    maxBytes: 2097152,
    validUntil: new Date(Date.now() + 240000).toISOString(),
    baselineHash: baseline,
  };
  const msg = await fetch(BASE + '/api/reqs/' + reqId + '/messages', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      content: '对当前工作区执行计划内命令并汇报：先 git status --short，再 node --version。',
      stage: 'dev',
      mode: 'real',
      tool: 'exec',
      workspace: ws,
      control,
      expectedRevision: d.revision,
      commandId: '58-e2e-msg-' + Date.now().toString(36),
    }),
  });
  const msgj = await msg.json();
  console.log('sendMessage', msg.status, JSON.stringify({ jobId: msgj.jobId, jobKind: msgj.jobKind, reply: msgj.reply?.id, err: msgj.error?.code || msgj.error?.message }).slice(0, 300));
  if (msg.status !== 200 && msg.status !== 201) throw new Error('SEND_FAILED ' + JSON.stringify(msgj).slice(0, 400));
  const jobId = msgj.jobId;
  const aiMessageId = msgj.reply?.id;

  // 6. 轮询作业/消息（最长 240s）
  const deadline = Date.now() + 240000;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (jobId) {
      const r = await fetch(BASE + '/api/agent-runs?limit=20', { headers: auth }).catch(() => null);
      if (r && r.ok) {
        const rj = await r.json();
        const runs = rj.runs || rj.items || [];
        const run = runs.find((x) => x.id === jobId || x.jobId === jobId);
        if (run && !['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'DISPATCHING'].includes(run.state)) {
          final = { runState: run.state, outcome: run.outcome?.status || run.status, code: run.outcome?.code || null };
          break;
        }
      }
    }
    const m = await fetch(BASE + '/api/reqs/' + reqId + '/messages?offset=0&limit=10', { headers: auth });
    const mj = await m.json();
    const list = mj.messages || mj.items || [];
    const ai = list.find((x) => x.id === aiMessageId) || [...list].reverse().find((x) => x.role === 'ai');
    if (ai && ai.status !== 'generating') {
      final = { msgStatus: ai.status, contentLen: (ai.content || '').length, real: !!ai.metadata?.real };
      break;
    }
  }
  console.log('E2E_RESULT', JSON.stringify({ reqId, reqName, jobId, aiMessageId, final: final || 'TIMEOUT' }));
  const ok = final && (final.msgStatus === 'completed' || final.msgStatus === 'ok' || final.runState === 'SUCCEEDED' || final.outcome === 'SUCCEEDED');
  console.log('E2E_VERDICT', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 3);
}
main().catch((e) => { console.error('E2E_ERR', e.message); process.exit(1); });
