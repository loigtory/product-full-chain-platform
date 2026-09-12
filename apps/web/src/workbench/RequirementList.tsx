import { ClipboardList } from 'lucide-react';

import type {
  RequirementListItemDto,
  RequirementListView,
} from '@pfc/contracts';
import { DataTableFrame } from '@pfc/ui';

import { StatusPill } from '../StatusPill.tsx';
import { friendlyOwner, friendlyTimestamp, stages } from './model.tsx';

export function RequirementList({
  items,
  view,
  loading,
  search,
  onOpen,
}: {
  items: readonly RequirementListItemDto[];
  view: RequirementListView;
  loading: boolean;
  search: string;
  onOpen: (id: string) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <div
        aria-label="正在读取需求列表"
        className="list-skeleton"
        role="status"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <span />
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <ClipboardList aria-hidden="true" size={28} strokeWidth={1.7} />
        <strong>{search ? '没有匹配的需求' : '当前范围暂无需求'}</strong>
        <p>
          {search ? '调整关键词或清除搜索后继续。' : '创建首条需求开始登记。'}
        </p>
      </div>
    );
  }

  if (view === 'STAGE') {
    return (
      <div className="stage-board" data-testid="stage-board">
        {stages.map((stage) => {
          const stageItems = items.filter(
            (item) => item.currentStage === stage,
          );
          return (
            <section className="stage-column" key={stage}>
              <header>
                <strong>{stage}</strong>
                <span>{stageItems.length}</span>
              </header>
              <div className="stage-items">
                {stageItems.map((item) => (
                  <button
                    className="stage-item"
                    key={item.id}
                    onClick={() => onOpen(item.id)}
                    type="button"
                  >
                    <span>{item.name}</span>
                    <StatusPill value={item.gateProjection} />
                    <small>{item.nextAction}</small>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <DataTableFrame className="table-wrap">
      <table aria-label="需求列表">
        <thead>
          <tr>
            <th>需求名称</th>
            <th>当前阶段</th>
            <th>门禁状态</th>
            <th>责任人</th>
            <th>下一步</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="requirement-name-cell">
                  <button
                    className="table-link"
                    onClick={() => onOpen(item.id)}
                    title={item.id}
                    type="button"
                  >
                    {item.name}
                  </button>
                </div>
                {item.warningCode ? (
                  <span className="row-warning">部分信息不可用</span>
                ) : null}
              </td>
              <td>{item.currentStage}</td>
              <td>
                <StatusPill value={item.gateProjection} />
              </td>
              <td title={item.ownerId}>{friendlyOwner(item.ownerId)}</td>
              <td>{item.nextAction}</td>
              <td>{friendlyTimestamp(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
