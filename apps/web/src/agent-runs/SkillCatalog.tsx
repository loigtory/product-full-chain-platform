import type { SkillReleaseDto } from '@pfc/contracts';
import { Badge, DataTableFrame, EmptyState } from '@pfc/ui';
import { Library } from 'lucide-react';

import { formatAgentRunTimestamp } from './model.ts';

export function SkillCatalog({
  items,
  loading,
}: {
  items: readonly SkillReleaseDto[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="agent-runs-state" role="status">
        正在读取 Skill 目录...
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        description="当前团队范围内还没有通过评估并启用的 Skill。"
        icon={<Library aria-hidden="true" size={24} strokeWidth={1.8} />}
        title="暂无可用 Skill"
      />
    );
  }
  return (
    <DataTableFrame className="skill-catalog-table">
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>版本</th>
            <th>风险</th>
            <th>评估</th>
            <th>能力范围</th>
            <th>登记时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.displayName}</strong>
                <small>{item.description}</small>
              </td>
              <td>{item.version}</td>
              <td>
                <Badge
                  variant={item.riskLevel === 'LOW' ? 'success' : 'warning'}
                >
                  {item.riskLevel === 'LOW' ? '低风险' : item.riskLevel}
                </Badge>
              </td>
              <td>
                {item.evaluationStatus === 'PASSED' ? '已通过' : '未通过'}
              </td>
              <td>{item.enabledScopes.join('、')}</td>
              <td>{formatAgentRunTimestamp(item.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
