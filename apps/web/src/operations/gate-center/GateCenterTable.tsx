import type { GateCenterItemDto } from '@pfc/contracts';
import { statusLabel } from '@pfc/ui';

import { StatusPill } from '../../StatusPill.tsx';
import { timestamp } from '../model.ts';

export function GateCenterTable({
  items,
  onOpenRequirement,
}: {
  items: readonly GateCenterItemDto[];
  onOpenRequirement: (id: string) => void;
}) {
  return (
    <div className="operations-table-wrap">
      <table
        className="operations-table gate-center-table"
        aria-label="门禁中心"
      >
        <thead>
          <tr>
            <th>需求</th>
            <th>阶段</th>
            <th>状态</th>
            <th>模式 / 有效性</th>
            <th>责任人</th>
            <th>下一步</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <td>
                <div className="requirement-name-cell">
                  <button
                    className="table-link"
                    onClick={() => onOpenRequirement(item.requirementId)}
                    type="button"
                  >
                    {item.requirementName}
                  </button>
                  <span className="requirement-code">
                    {item.requirementId} · 历史 {item.historyCount} 次
                  </span>
                </div>
              </td>
              <td>
                <strong className="stage-value">{item.stage}</strong>
                {item.requirementStage !== item.stage ? (
                  <small>当前 {item.requirementStage}</small>
                ) : null}
              </td>
              <td>
                <StatusPill value={item.status} />
              </td>
              <td>
                <span>
                  {item.mode === 'AUTOMATIC'
                    ? '自动'
                    : item.mode === 'MANUAL'
                      ? '人工'
                      : '尚未运行'}
                </span>
                {item.validity ? (
                  <small>{statusLabel(item.validity)}</small>
                ) : null}
              </td>
              <td title={item.ownerId}>
                <span className="cell-ellipsis">{item.ownerId}</span>
                <small>
                  {timestamp(
                    item.completedAt ?? item.startedAt ?? item.updatedAt,
                  )}
                </small>
              </td>
              <td>
                <button
                  className="row-action"
                  onClick={() => onOpenRequirement(item.requirementId)}
                  type="button"
                >
                  {item.nextAction}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
