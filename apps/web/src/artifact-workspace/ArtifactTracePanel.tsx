import { ArtifactTraceList } from '@pfc/ui';

import type { ArtifactTraceGraphDto } from './api.ts';

const subjectLabels = {
  REQUIREMENT: '需求',
  CAPABILITY: '能力',
  UNIT: '交付单元',
  ACCEPTANCE_CRITERION: '验收标准',
  ARTIFACT_VERSION: '制品版本',
  AGENT_RUN: 'Agent 运行',
  EVIDENCE: '来源材料',
} as const;

export function ArtifactTracePanel({
  graph,
}: {
  graph: ArtifactTraceGraphDto | null;
}) {
  const subjects = new Map(
    graph
      ? [graph.subject, ...graph.subjects].map((subject) => [
          subject.id,
          subject,
        ])
      : [],
  );
  return (
    <div className="artifact-trace-panel">
      <ArtifactTraceList
        items={(graph?.links ?? []).map((link) => {
          const incoming = link.targetSubjectId === graph?.subject.id;
          const related = subjects.get(
            incoming ? link.sourceSubjectId : link.targetSubjectId,
          );
          return {
            id: link.id,
            direction: incoming ? 'INCOMING' : 'OUTGOING',
            relation: link.relationType,
            subject: related ? subjectLabels[related.subjectType] : '未知对象',
            locator: related?.locator ?? '-',
            validity: link.validity,
          };
        })}
      />
    </div>
  );
}
