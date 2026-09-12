import { FileClock } from 'lucide-react';

import type { MaterialLibraryItemDto } from '@pfc/contracts';

import { StatusPill } from '../../StatusPill.tsx';
import { purposeLabels, sensitivityLabels, sourceLabels } from '../model.ts';

function MaterialRefs({ item }: { item: MaterialLibraryItemDto }) {
  if (item.materialRefs.length === 0)
    return <span className="muted-cell">无引用</span>;
  return (
    <details className="material-refs">
      <summary>{item.materialRefs.length} 个引用</summary>
      <ul>
        {item.materialRefs.map((ref) => (
          <li key={ref.id}>
            <strong>{ref.referenceType}</strong>
            <span>
              {ref.source} · v{ref.version ?? '-'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MaterialLibraryTable({
  items,
  onOpenRequirement,
}: {
  items: readonly MaterialLibraryItemDto[];
  onOpenRequirement: (id: string) => void;
}) {
  return (
    <div className="operations-table-wrap">
      <table
        className="operations-table material-library-table"
        aria-label="材料库"
      >
        <thead>
          <tr>
            <th>需求 / 基线</th>
            <th>状态</th>
            <th>来源 / 用途</th>
            <th>敏感级别</th>
            <th>材料引用</th>
            <th>影响处理</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.baselineId}>
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
                    v{item.versionNumber} · {item.baselineId}
                  </span>
                </div>
              </td>
              <td>
                <StatusPill value={item.status} />
                <small>需求 {item.requirementStage}</small>
              </td>
              <td>
                <span>{sourceLabels[item.sourceType]}</span>
                <small>{purposeLabels[item.materialPurpose]}</small>
              </td>
              <td>
                <span>{sensitivityLabels[item.sensitivity]}</span>
                <small>{item.confirmedBy}</small>
              </td>
              <td>
                <MaterialRefs item={item} />
              </td>
              <td>
                {item.pendingImpact ? (
                  <div className="pending-impact-cell">
                    <span>
                      <FileClock
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.8}
                      />
                      待确认 · 建议回退 {item.pendingImpact.recommendedStage}
                    </span>
                    <button
                      className="row-action"
                      onClick={() => onOpenRequirement(item.requirementId)}
                      type="button"
                    >
                      处理影响
                    </button>
                  </div>
                ) : (
                  <span className="muted-cell">无待处理影响</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
