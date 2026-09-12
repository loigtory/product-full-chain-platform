const labels: Readonly<Record<string, string>> = {
  ANSWERED: '已回答',
  AVAILABLE: '可用',
  BLOCK: '阻断',
  CANCELLED: '已取消',
  CANDIDATE: '候选',
  COMPLETED: '已完成',
  CONFIRMED: '已确认',
  CURRENT: '当前',
  DEFERRED: '已延期',
  HISTORICAL: '历史',
  IN_PROGRESS: '进行中',
  INVALIDATED: '已失效',
  NOT_APPLICABLE: '不适用',
  NOT_STARTED: '未开始',
  OPEN: '待回答',
  PASS: '已通过',
  PENDING: '待确认',
  PROCESSING: '处理中',
  STALE_BASELINE: '基线已过期',
  SUPERSEDED: '已替代',
  UNAVAILABLE: '不可用',
  UNKNOWN: '待确认',
  WARN: '需关注',
};

export function statusLabel(value: string): string {
  return labels[value] ?? value;
}

export * from './components/index.ts';
export * from './patterns/index.ts';
