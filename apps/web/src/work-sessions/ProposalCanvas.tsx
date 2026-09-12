import type {
  ActionProposalDto,
  ProductWorkSessionSnapshotDto,
} from '@pfc/contracts';
import {
  ActionProposalCard,
  ArtifactCanvas,
  Badge,
  Button,
  VersionDiffReview,
  WorkBlock,
} from '@pfc/ui';
import { Check, X } from 'lucide-react';

const proposalNames: Record<ActionProposalDto['kind'], string> = {
  COMPLETE_G0_REGISTRATION: '补齐 G0 需求登记',
  ANSWER_QUESTION: '回答需求问题',
  CONFIRM_QUESTION: '确认产品决定',
  REGISTER_ARTIFACT: '登记产品产物',
  APPEND_ARTIFACT_VERSION: '新增产物版本',
  REGISTER_TRACE_LINK: '登记追溯链接',
  READ_MCP: '执行 MCP 只读查询',
  CREATE_AGENT_RUN: '创建受控 AgentRun',
};

function valueOf(value: string | number | boolean | null) {
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function ProposalCanvas({
  busyAction,
  onConfirm,
  onReject,
  snapshot,
}: {
  busyAction: string | null;
  onConfirm: () => void;
  onReject: () => void;
  snapshot: ProductWorkSessionSnapshotDto;
}) {
  const proposal = snapshot.pendingProposal;

  return (
    <ArtifactCanvas
      actions={
        <Badge variant={proposal ? 'warning' : 'info'}>
          {proposal ? '草稿' : '权威'}
        </Badge>
      }
      description="结构化对象与字段级变更"
      title="成果画布"
    >
      <div className="pfc-artifact-canvas__body">
        {proposal ? (
          <ActionProposalCard
            actions={
              <>
                <Button
                  icon={<X aria-hidden="true" size={16} strokeWidth={1.8} />}
                  loading={busyAction === 'reject-proposal'}
                  onClick={onReject}
                  size="sm"
                  variant="secondary"
                >
                  拒绝
                </Button>
                <Button
                  icon={
                    <Check aria-hidden="true" size={16} strokeWidth={1.8} />
                  }
                  loading={busyAction === 'confirm-proposal'}
                  onClick={onConfirm}
                  size="sm"
                >
                  确认并应用
                </Button>
              </>
            }
            meta={`${proposal.target.aggregateType} · 目标版本 ${proposal.target.rowVersion} · ${proposal.confirmationRequirement}`}
            title={proposalNames[proposal.kind]}
          >
            <VersionDiffReview
              ariaLabel="提案字段变更"
              rows={proposal.displayDiff.map((item) => ({
                field: item.field,
                before: valueOf(item.before),
                after: valueOf(item.after),
              }))}
            />
          </ActionProposalCard>
        ) : (
          <WorkBlock eyebrow="当前权威对象" title={snapshot.requirement.name}>
            <p>
              阶段 {snapshot.requirement.currentStage} · 版本{' '}
              {snapshot.requirement.rowVersion} · 基线{' '}
              {snapshot.requirement.currentBaselineId ?? '尚未形成'}
            </p>
          </WorkBlock>
        )}
      </div>
    </ArtifactCanvas>
  );
}
