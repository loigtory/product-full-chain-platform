import {
  LIFECYCLE_STAGES,
  type ProductWorkSessionSnapshotDto,
} from '@pfc/contracts';
import { Button, LifecycleRail, RequirementContextHeader } from '@pfc/ui';
import { ArrowLeft, Focus, PanelLeftOpen } from 'lucide-react';

const stageLabels = [
  '登记',
  '澄清',
  '范围',
  '方案',
  '技术',
  '计划',
  '开发',
  '测试',
  '验收',
  '发布准备',
  '产品验收',
  '发布授权',
  '业务验收',
] as const;

function risk(snapshot: ProductWorkSessionSnapshotDto) {
  if (snapshot.session.status === 'BLOCKED') {
    return { tone: 'danger' as const, value: '结果待核验' };
  }
  if (snapshot.pendingProposal) {
    return { tone: 'warning' as const, value: '1 项待确认' };
  }
  return { tone: 'success' as const, value: '状态正常' };
}

export function RequirementWorkspaceContext({
  actorName,
  onContextOpen,
  onFocusComposer,
  snapshot,
}: {
  actorName: string;
  onContextOpen: () => void;
  onFocusComposer: () => void;
  snapshot: ProductWorkSessionSnapshotDto;
}) {
  const currentRisk = risk(snapshot);
  const owner =
    snapshot.requirement.businessOwnerId === snapshot.session.ownerId
      ? actorName
      : (snapshot.requirement.businessOwnerId ?? '待指定');

  return (
    <RequirementContextHeader
      actions={
        <>
          <Button
            icon={<ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={() => window.location.assign('/')}
            size="sm"
            variant="ghost"
          >
            返回需求
          </Button>
          <Button
            icon={
              <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.8} />
            }
            onClick={onContextOpen}
            size="sm"
            variant="secondary"
          >
            上下文
          </Button>
          <Button
            icon={<Focus aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={onFocusComposer}
            size="sm"
          >
            继续作业
          </Button>
        </>
      }
      context={`${snapshot.session.title ?? '产品 Agent 协作'} · ${snapshot.requirement.id}`}
      meta={[
        {
          label: '当前阶段',
          value: `阶段 ${snapshot.requirement.currentStage}`,
        },
        {
          label: '权威版本',
          value: `版本 ${snapshot.requirement.rowVersion}`,
        },
        { label: 'Owner', value: `Owner · ${owner}` },
        {
          label: '风险',
          tone: currentRisk.tone,
          value: currentRisk.value,
        },
      ]}
      title={snapshot.requirement.name}
    />
  );
}

export function RequirementLifecycle({
  snapshot,
}: {
  snapshot: ProductWorkSessionSnapshotDto;
}) {
  const currentIndex = LIFECYCLE_STAGES.indexOf(
    snapshot.requirement.currentStage,
  );
  return (
    <LifecycleRail
      ariaLabel="需求生命周期"
      items={LIFECYCLE_STAGES.map((stage, index) => ({
        label: stageLabels[index]!,
        state:
          index === currentIndex
            ? snapshot.session.status === 'BLOCKED'
              ? 'blocked'
              : 'current'
            : index < currentIndex
              ? 'complete'
              : 'upcoming',
        value: stage,
      }))}
    />
  );
}
