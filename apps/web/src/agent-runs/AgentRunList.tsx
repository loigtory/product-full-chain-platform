import type { AgentRunDto } from '@pfc/contracts';
import { Badge, DataTableFrame, EmptyState } from '@pfc/ui';
import { Bot } from 'lucide-react';

import {
  agentRunStatusLabel,
  agentRunStatusVariant,
  formatAgentRunTimestamp,
} from './model.ts';

export function AgentRunList({
  items,
  loading,
  onSelect,
  selectedId,
}: {
  items: readonly AgentRunDto[];
  loading: boolean;
  onSelect: (runId: string) => void;
  selectedId: string | null;
}) {
  if (loading) {
    return (
      <div className="agent-runs-state" role="status">
        正在读取运行记录...
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        description="调整搜索条件，或从需求详情发起只读检查。"
        icon={<Bot aria-hidden="true" size={24} strokeWidth={1.8} />}
        title="没有匹配的运行"
      />
    );
  }
  return (
    <DataTableFrame className="agent-run-list">
      <table>
        <thead>
          <tr>
            <th>运行编号</th>
            <th>状态</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={selectedId === item.id ? 'is-selected' : undefined}
              key={item.id}
            >
              <td>
                <button onClick={() => onSelect(item.id)} type="button">
                  {item.id}
                </button>
              </td>
              <td>
                <Badge variant={agentRunStatusVariant(item.status)}>
                  {agentRunStatusLabel(item.status)}
                </Badge>
              </td>
              <td>{formatAgentRunTimestamp(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
