import { useEffect, useState } from 'react';
import { Eye, ShieldCheck, X } from 'lucide-react';

import type { AgentApprovalDto } from '@pfc/contracts';
import {
  Badge,
  Button,
  DataTableFrame,
  DecisionFooter,
  Drawer,
  EmptyState,
  ScopeDiff,
  WorkPanel,
} from '@pfc/ui';

import type { AgentRunsApi } from './api.ts';
import { formatAgentRunTimestamp } from './model.ts';

const kindLabels: Record<AgentApprovalDto['kind'], string> = {
  RUN_START: '启动范围审批',
  COMMAND_EXECUTION: '命令执行审批',
  FILE_CHANGE: '文件变更审批',
  PERMISSIONS: '权限审批',
};

const decisionLabels: Record<AgentApprovalDto['decision'], string> = {
  PENDING: '待审批',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
  CANCELLED: '已取消',
};

function decisionVariant(decision: AgentApprovalDto['decision']) {
  if (decision === 'APPROVED') return 'success' as const;
  if (decision === 'PENDING') return 'warning' as const;
  if (decision === 'REJECTED' || decision === 'EXPIRED') {
    return 'danger' as const;
  }
  return 'neutral' as const;
}

export function ApprovalInbox({
  api,
  revision,
  onChanged,
}: {
  api: AgentRunsApi;
  revision: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<readonly AgentApprovalDto[]>([]);
  const [selected, setSelected] = useState<AgentApprovalDto | null>(null);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = loadedRevision !== revision;

  useEffect(() => {
    let active = true;
    void api
      .listApprovals()
      .then((response) => {
        if (active) {
          setItems(response.items);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : '审批读取失败。');
        }
      })
      .finally(() => {
        if (active) setLoadedRevision(revision);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);

  async function openApproval(approval: AgentApprovalDto) {
    setError(null);
    setSelected(approval);
    try {
      setSelected(await api.getApproval(approval.runId, approval.id));
    } catch (reason) {
      setSelected(null);
      setError(reason instanceof Error ? reason.message : '审批详情读取失败。');
    }
  }

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!selected) return;
    setDeciding(true);
    setError(null);
    try {
      await api.decideApproval(selected.id, selected.rowVersion, {
        decision,
        reasonCode:
          decision === 'APPROVED' ? 'SCOPE_REVIEWED' : 'MANUAL_REJECTED',
        ...(decision === 'APPROVED'
          ? { approvedScope: selected.requestedScope }
          : {}),
      });
      setSelected(null);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审批提交失败。');
    } finally {
      setDeciding(false);
    }
  }

  const cannotApprove =
    selected?.outsideCapsule === true ||
    selected?.requestedScope.networkAccess === true;

  return (
    <WorkPanel
      className="agent-approval-inbox"
      description="按运行范围逐项核对；批准只对本次请求生效。"
      title="审批收件箱"
    >
      {error ? (
        <p className="agent-runs-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="agent-runs-state" role="status">
          正在读取审批...
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          description="需要人工确认的写入请求会出现在这里。"
          icon={<ShieldCheck size={24} strokeWidth={1.8} />}
          title="暂无待办审批"
        />
      ) : (
        <DataTableFrame className="agent-approval-table">
          <table>
            <thead>
              <tr>
                <th>审批类型</th>
                <th>作用范围</th>
                <th>请求时间</th>
                <th>状态</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {items.map((approval) => (
                <tr key={approval.id}>
                  <td>
                    <strong>{kindLabels[approval.kind]}</strong>
                    <small>{approval.runId}</small>
                  </td>
                  <td>
                    {approval.requestedScope.allowedRelativePaths.map(
                      (path) => (
                        <code key={path}>{path}</code>
                      ),
                    )}
                    <small>
                      {approval.requestedScope.allowedActions.join('、')} · 最多{' '}
                      {approval.requestedScope.maxChangedFiles} 个文件 /{' '}
                      {approval.requestedScope.maxChangedBytes} 字节
                    </small>
                  </td>
                  <td>
                    <span>{formatAgentRunTimestamp(approval.requestedAt)}</span>
                    <small>发起人 {approval.requestedBy}</small>
                    <small>
                      失效 {formatAgentRunTimestamp(approval.expiresAt)}
                    </small>
                  </td>
                  <td>
                    <Badge variant={decisionVariant(approval.decision)}>
                      {decisionLabels[approval.decision]}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      icon={
                        <Eye aria-hidden="true" size={15} strokeWidth={1.8} />
                      }
                      onClick={() => void openApproval(approval)}
                      size="sm"
                      variant="ghost"
                    >
                      查看审批
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      )}
      {selected ? (
        <Drawer
          aria-label={kindLabels[selected.kind]}
          closeIcon={<X aria-hidden="true" size={18} strokeWidth={1.8} />}
          description={`运行 ${selected.runId}`}
          onClose={() => setSelected(null)}
          title={kindLabels[selected.kind]}
        >
          <div className="agent-approval-detail">
            {selected.kind === 'RUN_START' ? (
              <p className="agent-approval-context">
                批准后才会创建写作业启动命令；拒绝或过期不会启动 Codex。
              </p>
            ) : (
              <p className="agent-approval-context">
                这是作业运行期间由 Codex 提出的额外权限请求。
              </p>
            )}
            {selected.outsideCapsule ? (
              <p className="agent-approval-warning" role="alert">
                请求超出运行胶囊，不能批准。
              </p>
            ) : null}
            <ScopeDiff
              approved={
                selected.approvedScope
                  ? {
                      label: '批准范围',
                      paths: selected.approvedScope.allowedRelativePaths,
                      actions: selected.approvedScope.allowedActions,
                      maxChangedFiles: selected.approvedScope.maxChangedFiles,
                      maxChangedBytes: selected.approvedScope.maxChangedBytes,
                      networkAccess: selected.approvedScope.networkAccess,
                    }
                  : undefined
              }
              requested={{
                label: '请求范围',
                paths: selected.requestedScope.allowedRelativePaths,
                actions: selected.requestedScope.allowedActions,
                maxChangedFiles: selected.requestedScope.maxChangedFiles,
                maxChangedBytes: selected.requestedScope.maxChangedBytes,
                networkAccess: selected.requestedScope.networkAccess,
              }}
            />
            {selected.decision !== 'PENDING' ? (
              <dl className="agent-approval-decision">
                <div>
                  <dt>处理结果</dt>
                  <dd>{decisionLabels[selected.decision]}</dd>
                </div>
                <div>
                  <dt>处理人</dt>
                  <dd>{selected.decidedBy ?? '系统'}</dd>
                </div>
                <div>
                  <dt>处理时间</dt>
                  <dd>
                    {selected.decidedAt
                      ? formatAgentRunTimestamp(selected.decidedAt)
                      : '尚未记录'}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
          {selected.decision === 'PENDING' ? (
            <DecisionFooter guidance="批准不会扩大路径、动作或影响上限。">
              <Button
                disabled={deciding}
                onClick={() => void decide('REJECTED')}
                variant="secondary"
              >
                拒绝
              </Button>
              <Button
                disabled={cannotApprove}
                loading={deciding}
                onClick={() => void decide('APPROVED')}
              >
                批准一次
              </Button>
            </DecisionFooter>
          ) : null}
        </Drawer>
      ) : null}
    </WorkPanel>
  );
}
