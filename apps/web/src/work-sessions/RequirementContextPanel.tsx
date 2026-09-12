import type { ProductWorkSessionSnapshotDto } from '@pfc/contracts';
import { Badge, ContextGroup, ContextRail } from '@pfc/ui';

function shortId(value: string) {
  return value.length > 26
    ? `${value.slice(0, 12)}...${value.slice(-8)}`
    : value;
}

export function RequirementContextPanel({
  snapshot,
}: {
  snapshot: ProductWorkSessionSnapshotDto;
}) {
  const sources = snapshot.contextItems.map((item) => ({
    label: shortId(item.targetId),
    meta: `${item.contextType} · v${item.targetVersion ?? 'current'}`,
    status: (
      <Badge variant={item.invalidatedAt ? 'danger' : 'success'}>
        {item.invalidatedAt ? '已失效' : item.sensitivity}
      </Badge>
    ),
  }));
  const question =
    snapshot.pendingProposal?.target.aggregateType === 'QUESTION'
      ? [
          {
            label: shortId(snapshot.pendingProposal.target.aggregateId),
            meta: '等待产品负责人确认',
            status: <Badge variant="warning">待确认</Badge>,
          },
        ]
      : [];
  const runs = snapshot.linkedAgentRunIds.map((id) => ({
    label: shortId(id),
    meta: 'AgentRun',
    status: <Badge variant="info">关联</Badge>,
  }));

  return (
    <ContextRail
      description={`${snapshot.contextItems.length} 项已授权上下文`}
      title="工作上下文"
    >
      <div className="pfc-context-rail__body">
        <ContextGroup items={sources} title="来源材料" />
        <ContextGroup items={question} title="待确认问题" />
        <ContextGroup
          items={
            snapshot.requirement.currentBaselineId
              ? [
                  {
                    label: shortId(snapshot.requirement.currentBaselineId),
                    meta: `需求版本 ${snapshot.requirement.rowVersion}`,
                    status: <Badge variant="info">当前</Badge>,
                  },
                ]
              : []
          }
          title="权威基线"
        />
        <ContextGroup items={runs} title="相关运行" />
      </div>
    </ContextRail>
  );
}
