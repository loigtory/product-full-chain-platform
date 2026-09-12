#!/usr/bin/env node
'use strict';
/* =====================================================================
 * PFC 模拟 Bridge Agent（sim-bridge.mjs）
 * 模拟本地开发终端（Zed / Codex / VS Code 会话代理）：
 *   1. 连接 ws://127.0.0.1:<port>/ws/bridge?token=<bridgeToken>
 *   2. 每 30s 心跳
 *   3. 收到 job.start → 模拟终端对话流（逐行 job.line，600ms 间隔）→ job.done
 * 用法：node sim-bridge.mjs --port 5188 --token <bridgeToken> [--name "本地开发电脑"]
 * 诚实标注：这是协议模拟器，用于演示 Bridge 实时对话流；真实终端适配在 Bridge 客户端。
 * ===================================================================== */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const port = Number(args.port || 5188);
const token = process.env.PFC_BRIDGE_TOKEN || args.token;
const name = args.name || '模拟开发终端';

if (!token) {
  console.error(
    '[sim-bridge] 缺少 --token <bridgeToken>（先 POST /api/bridges/pair 获取）',
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(
  'ws://127.0.0.1:' + port + '/ws/bridge?token=' + encodeURIComponent(token),
);
const jobs = new Map(),
  dispatches = new Map(),
  sequences = new Map();
function send(event) {
  const dispatchId = dispatches.get(event.runId);
  if (dispatchId) {
    const seq = (sequences.get(event.runId) || 0) + 1;
    sequences.set(event.runId, seq);
    event = { ...event, dispatchId, seq, eventId: dispatchId + ':' + seq };
  }
  ws.send(JSON.stringify(event));
}
let heartbeat;

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'bridge.hello', simulated: true }));
  console.log('[sim-bridge] 已连接 ' + name + ' @ ws://127.0.0.1:' + port);
  heartbeat = setInterval(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' }));
  }, 30000);
};

ws.onmessage = async (ev) => {
  let m;
  try {
    m = JSON.parse(String(ev.data));
  } catch {
    return;
  }
  if (m.type === 'job.cancel') {
    jobs.set(m.runId, 'cancelled');
    send({ type: 'job.cancelled', runId: m.runId });
    return;
  }
  if (m.type === 'job.start' && !jobs.has(m.runId)) {
    jobs.set(m.runId, 'running');
    dispatches.set(m.runId, m.dispatchId);
    sequences.set(m.runId, 0);
    console.log(
      '[sim-bridge] 收到 job.start runId=' +
        m.runId +
        ' reqId=' +
        m.reqId +
        ' operation=' +
        m.operation,
    );
    const lines = [
      { cls: 'cmd', text: m.operation + '：已连接工作区（git@main）' },
      { cls: 'info', text: '读取需求 ' + m.reqId + ' 与现有接口…' },
      { cls: 'cmd', text: '创建 src/notify/reminder-task.ts（变更起草）' },
      { cls: 'ok', text: '单元测试 3 passed' },
      { cls: 'cmd', text: '生成迁移 20260910_create_reminder_task.ts（待审）' },
    ];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (ws.readyState !== 1 || jobs.get(m.runId) !== 'running') return;
      send({
        type: 'job.line',
        runId: m.runId,
        cls: l.cls,
        text: '[模拟 Bridge] ' + l.text,
      });
      send({
        type: 'job.snapshot',
        runId: m.runId,
        stepNo: i + 1,
        label: l.cls + ' ' + l.text,
        snapshotRef: 'sim://run/' + m.runId + '/step' + (i + 1),
      });
      console.log('[sim-bridge] job.line ' + l.cls + ' ' + l.text);
      await sleep(600);
    }
    if (ws.readyState !== 1 || jobs.get(m.runId) !== 'running') return;
    jobs.set(m.runId, 'done');
    send({ type: 'job.done', runId: m.runId, exitCode: 0 });
    console.log('[sim-bridge] job.done exit=0');
  }
};

ws.onerror = (e) => console.error('[sim-bridge] 连接错误：', e.message || e);
ws.onclose = () => {
  clearInterval(heartbeat);
  console.log('[sim-bridge] 连接关闭，退出模拟器');
  setTimeout(() => {
    process.exit(0); // 简化：关闭即退出，由上层重启
  }, 1000);
};
