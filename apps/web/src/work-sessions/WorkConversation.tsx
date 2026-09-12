import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { PauseCircle, ShieldCheck } from 'lucide-react';

import type {
  ExecutionEvidenceDto,
  McpReadRequestDto,
  ProductWorkSessionSnapshotDto,
  ProductWorkTurnDto,
} from '@pfc/contracts';
import {
  AgentComposer,
  Badge,
  Button,
  RecoveryCard,
  RunProgressCard,
  WorkMessage,
  WorkStream,
} from '@pfc/ui';
import type { WorkSessionStreamState } from './api.ts';
import { shouldAutoFollowConversation } from './conversation-positioning.ts';
import { McpToolCalls } from './McpToolCalls.tsx';

const AUTO_FOLLOW_THRESHOLD_PX = 96;

function streamDescription(state: WorkSessionStreamState): string {
  if (state === 'SYNCED') return '事件同步正常';
  if (state === 'RETRYING') return '正在重连事件同步';
  if (state === 'OFFLINE') return '事件同步离线';
  return '正在连接事件同步';
}

function statusTone(status: ProductWorkTurnDto['status']) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'FAILED' || status === 'UNKNOWN') return 'danger' as const;
  if (status === 'CANCELLED') return 'neutral' as const;
  return 'info' as const;
}

function statusLabel(status: ProductWorkTurnDto['status']) {
  const labels: Record<ProductWorkTurnDto['status'], string> = {
    RECEIVED: '已接收',
    QUEUED: '排队中',
    RUNNING: '运行中',
    WAITING_INPUT: '等待输入',
    PROPOSING: '形成建议',
    COMPLETED: '回合已完成',
    FAILED: '执行失败',
    CANCELLING: '停止中',
    CANCELLED: '已取消',
    UNKNOWN: '结果待核验',
  };
  return labels[status];
}

export function WorkConversation({
  busyAction,
  canSubmit,
  composerRef,
  error,
  executionEvidence,
  latestTurn,
  mcpRequests,
  onCancel,
  onSubmit,
  onVerify,
  readinessPanel,
  snapshot,
  streamState,
  submissionScope,
}: {
  busyAction: string | null;
  canSubmit: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  error: string | null;
  executionEvidence: readonly ExecutionEvidenceDto[];
  latestTurn: ProductWorkTurnDto | null;
  mcpRequests: readonly McpReadRequestDto[];
  onCancel: () => void;
  onSubmit: (message: string) => void;
  onVerify: () => void;
  readinessPanel: ReactNode;
  snapshot: ProductWorkSessionSnapshotDto;
  streamState: WorkSessionStreamState;
  submissionScope: string;
}) {
  const [message, setMessage] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const ownSubmitPendingRef = useRef(false);
  const lastPositionedKeyRef = useRef<string | null>(null);
  const active =
    latestTurn &&
    !['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(
      latestTurn.status,
    );
  const disabled = !canSubmit;
  const latestPositionKey = latestTurn
    ? `${latestTurn.id}:${latestTurn.status}:${latestTurn.updatedAt}:${latestTurn.visibleResponse?.length ?? 0}`
    : null;

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed || !latestPositionKey) return;
    if (lastPositionedKeyRef.current === latestPositionKey) return;
    const initialRecovery = lastPositionedKeyRef.current === null;
    if (
      shouldAutoFollowConversation({
        initialRecovery,
        nearBottom: nearBottomRef.current,
        ownSubmitPending: ownSubmitPendingRef.current,
      })
    ) {
      feed.scrollTop = feed.scrollHeight;
      nearBottomRef.current = true;
      ownSubmitPendingRef.current = false;
    }
    lastPositionedKeyRef.current = latestPositionKey;
  }, [latestPositionKey]);

  function submit(value: string) {
    ownSubmitPendingRef.current = true;
    onSubmit(value);
    setMessage('');
  }

  return (
    <WorkStream
      actions={
        active ? (
          <Button
            icon={
              <PauseCircle aria-hidden="true" size={16} strokeWidth={1.8} />
            }
            loading={busyAction === 'cancel-turn'}
            onClick={onCancel}
            size="sm"
            variant="secondary"
          >
            停止
          </Button>
        ) : null
      }
      composer={
        <AgentComposer
          busy={busyAction === 'submit-turn'}
          disabled={disabled}
          label="给产品 Agent 的任务"
          onSubmit={submit}
          ref={composerRef}
          scope={submissionScope}
          submitLabel="发送"
          textareaProps={{
            onChange: (event) => setMessage(event.target.value),
            placeholder: '描述要澄清、设计或核验的产品问题',
            rows: 2,
          }}
          value={message}
        />
      }
      description={streamDescription(streamState)}
      feedRef={feedRef}
      onFeedScroll={(event) => {
        const feed = event.currentTarget;
        nearBottomRef.current =
          feed.scrollHeight - feed.scrollTop - feed.clientHeight <=
          AUTO_FOLLOW_THRESHOLD_PX;
      }}
      title="Agent 作业流"
    >
      {error ? (
        <RecoveryCard description={error} title="工作空间操作未完成" />
      ) : null}
      {readinessPanel}
      {[...snapshot.turns.items]
        .sort((left, right) => left.sequence - right.sequence)
        .map((turn) => (
          <div className="pfc-work-stream__turn" key={turn.id}>
            <WorkMessage
              actor="user"
              label="产品经理"
              meta={`回合 ${turn.sequence}`}
            >
              <p>{turn.inputText}</p>
            </WorkMessage>
            {turn.visibleResponse ? (
              <WorkMessage
                actor="agent"
                label="产品 Agent"
                meta={
                  <Badge variant={statusTone(turn.status)}>
                    {statusLabel(turn.status)}
                  </Badge>
                }
              >
                <p>{turn.visibleResponse}</p>
              </WorkMessage>
            ) : null}
            <McpToolCalls
              evidence={executionEvidence}
              requests={mcpRequests.filter(
                (request) => request.turnId === turn.id,
              )}
            />
            {turn.status === 'UNKNOWN' ? (
              <RecoveryCard
                action={
                  <Button
                    icon={
                      <ShieldCheck
                        aria-hidden="true"
                        size={16}
                        strokeWidth={1.8}
                      />
                    }
                    loading={busyAction === 'verify-turn'}
                    onClick={onVerify}
                    size="sm"
                    variant="secondary"
                  >
                    核验回合
                  </Button>
                }
                description="未把未知结果当作成功，也不会自动重试写入动作。"
                title="结果待核验"
              />
            ) : null}
            {active && turn.id === latestTurn?.id ? (
              <RunProgressCard
                eyebrow={`回合 ${turn.sequence}`}
                title={statusLabel(turn.status)}
              >
                <p>最近状态来自服务端；可随时停止，完成前不会修改权威对象。</p>
              </RunProgressCard>
            ) : null}
          </div>
        ))}
      {!snapshot.turns.items.length ? (
        <RunProgressCard eyebrow="尚未开始" title="发起第一个产品作业">
          <p>绑定真实上下文和固定 Skill 后，可在下方提交工作意图。</p>
        </RunProgressCard>
      ) : null}
    </WorkStream>
  );
}
