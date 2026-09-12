import type { AgentRunEventType, AgentRunStatus } from '@pfc/contracts';
import type { BadgeVariant } from '@pfc/ui';

const runStatusLabels: Readonly<Record<AgentRunStatus, string>> = {
  QUEUED: '排队中',
  STARTING: '启动中',
  RUNNING: '运行中',
  WAITING_INPUT: '等待输入',
  WAITING_APPROVAL: '等待授权',
  CANCELLING: '取消中',
  UNKNOWN: '状态待核验',
  VERIFYING: '结果核验中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  RETRY_QUEUED: '等待重试',
};

const eventLabels: Readonly<Record<AgentRunEventType, string>> = {
  RUN_QUEUED: '运行已入队',
  BRIDGE_ASSIGNED: 'Bridge 已分配',
  APP_SERVER_INITIALIZED: 'Codex 服务已就绪',
  THREAD_STARTED: '会话已创建',
  TURN_STARTED: '任务已开始',
  AGENT_MESSAGE: '智能体消息',
  COMMAND_STARTED: '命令开始',
  COMMAND_COMPLETED: '命令完成',
  WAITING_INPUT: '等待输入',
  WAITING_APPROVAL: '等待授权',
  APPROVAL_REQUESTED: '已发起审批',
  APPROVAL_RESOLVED: '审批已处理',
  CANCEL_REQUESTED: '已请求取消',
  TURN_INTERRUPTED: '任务已中断',
  RUN_CANCELLED: '运行已取消',
  VERIFICATION_STARTED: '开始核验未知结果',
  VERIFICATION_COMPLETED: '未知结果核验完成',
  CAPSULE_VERIFIED: '隔离工作区已核验',
  BRIDGE_REVOKED: 'Bridge 已撤销',
  RUN_FAILED: '运行失败',
  RUN_UNKNOWN: '状态待核验',
  RESULT_RECORDED: '结果已记录',
};

export function agentRunStatusLabel(status: AgentRunStatus): string {
  return runStatusLabels[status];
}

export function agentRunStatusVariant(status: AgentRunStatus): BadgeVariant {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'danger';
  if (
    status === 'WAITING_APPROVAL' ||
    status === 'WAITING_INPUT' ||
    status === 'UNKNOWN'
  ) {
    return 'warning';
  }
  if (status === 'STARTING' || status === 'RUNNING' || status === 'VERIFYING') {
    return 'info';
  }
  return 'neutral';
}

export function agentRunEventLabel(eventType: AgentRunEventType): string {
  return eventLabels[eventType];
}

export function formatAgentRunTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function routeAgentRunId(): string | null {
  const match = /^\/jobs\/([^/]+)$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}
