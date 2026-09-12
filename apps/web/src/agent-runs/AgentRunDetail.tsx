import { useState } from 'react';
import type {
  AgentControlAction,
  AgentRunDto,
  AgentRunEventDto,
} from '@pfc/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DetailLayout,
  EmptyState,
  InfoPanel,
} from '@pfc/ui';
import { Activity, RefreshCw, SearchCheck, Square } from 'lucide-react';

import {
  agentRunEventLabel,
  agentRunStatusLabel,
  agentRunStatusVariant,
  formatAgentRunTimestamp,
} from './model.ts';

export function AgentRunDetail({
  events,
  loading,
  onControl,
  run,
}: {
  events: readonly AgentRunEventDto[];
  loading: boolean;
  onControl: (action: AgentControlAction, reasonCode: string) => Promise<void>;
  run: AgentRunDto | null;
}) {
  const [pendingAction, setPendingAction] = useState<AgentControlAction | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  if (loading) {
    return (
      <div className="agent-runs-state" role="status">
        正在读取运行详情...
      </div>
    );
  }
  if (!run) {
    return (
      <EmptyState
        description="从左侧运行列表选择一条记录查看。"
        icon={<Activity aria-hidden="true" size={24} strokeWidth={1.8} />}
        title="请选择运行"
      />
    );
  }

  const orderedEvents = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const canCancel = [
    'QUEUED',
    'RETRY_QUEUED',
    'STARTING',
    'RUNNING',
    'WAITING_INPUT',
    'WAITING_APPROVAL',
    'VERIFYING',
  ].includes(run.status);
  const canVerify = run.status === 'UNKNOWN';
  const canRetry =
    run.accessMode === 'WORKSPACE_WRITE' &&
    ['FAILED', 'CANCELLED'].includes(run.status);

  async function submitControl() {
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      await onControl(
        pendingAction,
        pendingAction === 'CANCEL'
          ? 'OPERATOR_CANCELLED'
          : pendingAction === 'VERIFY_UNKNOWN'
            ? 'OPERATOR_VERIFY_REQUESTED'
            : 'OPERATOR_RETRY_REQUESTED',
      );
      setPendingAction(null);
    } finally {
      setSubmitting(false);
    }
  }

  const controlTitle =
    pendingAction === 'CANCEL'
      ? '确认取消运行'
      : pendingAction === 'VERIFY_UNKNOWN'
        ? '确认核验未知结果'
        : '确认创建重试运行';
  const statusGuidance =
    run.status === 'WAITING_APPROVAL'
      ? '当前执行已挂起，需由另一位具备权限的成员核对请求范围。'
      : run.status === 'CANCELLING'
        ? '取消命令已发出；只有进程退出证据到达后才会进入已取消。'
        : run.status === 'UNKNOWN'
          ? '当前无法证明执行结果；核验只读取现有状态，不会重跑原动作。'
          : null;
  return (
    <DetailLayout
      aside={
        <InfoPanel title="执行上下文">
          <dl className="agent-run-facts">
            <div>
              <dt>需求</dt>
              <dd>{run.requirementId}</dd>
            </div>
            <div>
              <dt>需求基线</dt>
              <dd>{run.baselineId}</dd>
            </div>
            <div>
              <dt>工作区</dt>
              <dd>{run.workspaceId}</dd>
            </div>
            <div>
              <dt>Skill 发布</dt>
              <dd>{run.skillReleaseId}</dd>
            </div>
            <div>
              <dt>Git 基线</dt>
              <dd>
                <code>{run.gitBaseline}</code>
              </dd>
            </div>
            <div>
              <dt>访问模式</dt>
              <dd>{run.accessMode === 'READ_ONLY' ? '只读' : '工作区写入'}</dd>
            </div>
            <div>
              <dt>Bridge</dt>
              <dd>{run.bridgeId ?? '尚未分配'}</dd>
            </div>
            <div>
              <dt>Codex 会话</dt>
              <dd>{run.externalIds.threadId ?? '尚未创建'}</dd>
            </div>
          </dl>
        </InfoPanel>
      }
      primary={
        <>
          <InfoPanel
            actions={
              <Badge variant={agentRunStatusVariant(run.status)}>
                {agentRunStatusLabel(run.status)}
              </Badge>
            }
            title="运行结果"
          >
            <p className="agent-run-result">
              {run.resultSummary ??
                run.failureReason ??
                '运行尚未形成可读回的结果摘要。'}
            </p>
            <p className="agent-run-result-meta">
              最近更新 {formatAgentRunTimestamp(run.updatedAt)}
            </p>
            {statusGuidance ? (
              <p className="agent-run-status-guidance">{statusGuidance}</p>
            ) : null}
          </InfoPanel>
          <InfoPanel title="事件时间线">
            {orderedEvents.length === 0 ? (
              <p className="agent-run-muted">尚未收到可审计事件。</p>
            ) : (
              <ol className="agent-run-timeline">
                {orderedEvents.map((event) => (
                  <li key={event.id}>
                    <span aria-hidden="true" />
                    <div>
                      <strong>{agentRunEventLabel(event.eventType)}</strong>
                      <small>
                        #{event.sequence} ·{' '}
                        {formatAgentRunTimestamp(event.occurredAt)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </InfoPanel>
          {canCancel || canVerify || canRetry ? (
            <InfoPanel title="授权与控制">
              <div className="agent-run-controls">
                {canCancel ? (
                  <Button
                    icon={
                      <Square aria-hidden="true" size={15} strokeWidth={1.8} />
                    }
                    onClick={() => setPendingAction('CANCEL')}
                    size="sm"
                    variant="danger"
                  >
                    取消运行
                  </Button>
                ) : null}
                {canVerify ? (
                  <Button
                    icon={
                      <SearchCheck
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.8}
                      />
                    }
                    onClick={() => setPendingAction('VERIFY_UNKNOWN')}
                    size="sm"
                    variant="secondary"
                  >
                    核验结果
                  </Button>
                ) : null}
                {canRetry ? (
                  <Button
                    icon={
                      <RefreshCw
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.8}
                      />
                    }
                    onClick={() => setPendingAction('RETRY')}
                    size="sm"
                  >
                    创建重试
                  </Button>
                ) : null}
              </div>
            </InfoPanel>
          ) : null}
          {pendingAction ? (
            <ConfirmDialog
              actions={
                <>
                  <Button
                    disabled={submitting}
                    onClick={() => setPendingAction(null)}
                    variant="secondary"
                  >
                    返回
                  </Button>
                  <Button
                    loading={submitting}
                    onClick={() => void submitControl()}
                    variant={pendingAction === 'CANCEL' ? 'danger' : 'primary'}
                  >
                    确认执行
                  </Button>
                </>
              }
              onDismiss={() => setPendingAction(null)}
              title={controlTitle}
            >
              <p>
                操作将以当前版本 {run.rowVersion}{' '}
                提交并写入审计记录；状态已变化时会拒绝执行。
              </p>
            </ConfirmDialog>
          ) : null}
        </>
      }
    />
  );
}
