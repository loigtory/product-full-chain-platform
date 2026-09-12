import type { ExecutionEvidenceDto, McpReadRequestDto } from '@pfc/contracts';
import { Badge, WorkBlock } from '@pfc/ui';

function statusLabel(status: McpReadRequestDto['status']): string {
  const labels: Record<McpReadRequestDto['status'], string> = {
    REQUESTED: '已请求',
    QUEUED: '等待执行',
    LEASED: 'Bridge 已领取',
    RUNNING: '只读查询中',
    COMPLETED: '已归档',
    FAILED: '执行失败',
    UNKNOWN: '结果待核验',
  };
  return labels[status];
}

function tone(status: McpReadRequestDto['status']) {
  if (status === 'COMPLETED') return 'neutral' as const;
  if (status === 'UNKNOWN') return 'unknown' as const;
  if (status === 'FAILED') return 'unknown' as const;
  return 'running' as const;
}

function badgeTone(status: McpReadRequestDto['status']) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'FAILED' || status === 'UNKNOWN') return 'danger' as const;
  return 'info' as const;
}

function requestSummary(request: McpReadRequestDto): string {
  if (request.outputSummary) return request.outputSummary;
  if (request.failureReason) return `原因：${request.failureReason}`;
  if (request.status === 'UNKNOWN') return '调用可能已发生，平台不会自动重试。';
  return '参数正文只在租约内传给本机 Bridge，页面不展示原始输入。';
}

export function McpToolCalls({
  evidence,
  requests,
}: {
  evidence: readonly ExecutionEvidenceDto[];
  requests: readonly McpReadRequestDto[];
}) {
  return requests.map((request) => {
    const archivedEvidence = request.evidenceId
      ? evidence.find((item) => item.id === request.evidenceId)
      : null;
    return (
      <WorkBlock
        actions={
          <Badge variant={badgeTone(request.status)}>
            {statusLabel(request.status)}
          </Badge>
        }
        aria-label={`MCP 工具调用 ${request.logicalCapabilityId}`}
        eyebrow="MCP 只读能力"
        key={request.id}
        title={request.logicalCapabilityId}
        tone={tone(request.status)}
      >
        <p>{requestSummary(request)}</p>
        {request.durationMs !== null ? (
          <small>{`耗时 ${request.durationMs} ms · ${request.outputBytes ?? 0} bytes`}</small>
        ) : null}
        {archivedEvidence ? (
          <details>
            <summary>证据已归档</summary>
            <p>{archivedEvidence.id}</p>
            <small>{`${archivedEvidence.outcome} · ${archivedEvidence.retentionClass}`}</small>
          </details>
        ) : request.status === 'COMPLETED' ? (
          <p role="alert">证据归档待补齐，当前不计为闭环。</p>
        ) : null}
      </WorkBlock>
    );
  });
}
