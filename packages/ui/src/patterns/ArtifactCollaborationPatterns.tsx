import type { HTMLAttributes, ReactNode } from 'react';

import { Badge } from '../components/Badge.tsx';

export function ArtifactWorkspaceShell({
  ariaLabel,
  canvas,
  context,
  versions,
}: {
  ariaLabel: string;
  canvas: ReactNode;
  context: ReactNode;
  versions: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="pfc-artifact-workspace-shell">
      <aside className="pfc-artifact-workspace-shell__versions">
        {versions}
      </aside>
      <main className="pfc-artifact-workspace-shell__canvas">{canvas}</main>
      <aside className="pfc-artifact-workspace-shell__context">{context}</aside>
    </section>
  );
}

export interface ArtifactVersionRailItem {
  id: string;
  label: ReactNode;
  meta: ReactNode;
  createdAt: ReactNode;
}

export function ArtifactVersionRail({
  currentVersionId,
  onSelect,
  selectedVersionId,
  versions,
}: {
  currentVersionId: string;
  onSelect: (versionId: string) => void;
  selectedVersionId: string;
  versions: readonly ArtifactVersionRailItem[];
}) {
  return (
    <nav aria-label="制品版本" className="pfc-artifact-version-rail">
      <header>
        <span>版本历史</span>
        <Badge variant="neutral">{versions.length}</Badge>
      </header>
      <ol>
        {versions.map((version) => {
          const current = version.id === currentVersionId;
          return (
            <li key={version.id}>
              <button
                aria-pressed={version.id === selectedVersionId}
                onClick={() => onSelect(version.id)}
                type="button"
              >
                <span className="pfc-artifact-version-rail__marker" />
                <span className="pfc-artifact-version-rail__body">
                  <span className="pfc-artifact-version-rail__title">
                    <strong>{version.label}</strong>
                    {current ? <small>当前版本</small> : null}
                  </span>
                  <span>{version.meta}</span>
                  <time>{version.createdAt}</time>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface ArtifactDiffChangeItem {
  kind: 'UNCHANGED' | 'ADDED' | 'REMOVED';
  lines: readonly string[];
}

export function ArtifactDiffView({
  changes,
  className = '',
  fromLabel,
  toLabel,
  truncated = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  changes: readonly ArtifactDiffChangeItem[];
  fromLabel: ReactNode;
  toLabel: ReactNode;
  truncated?: boolean;
}) {
  return (
    <div
      {...props}
      className={`pfc-artifact-diff ${className}`.trim()}
      role="region"
      aria-label="版本差异"
    >
      <header>
        <span>{fromLabel}</span>
        <span aria-hidden="true">→</span>
        <strong>{toLabel}</strong>
        {truncated ? <Badge variant="warning">结果已截断</Badge> : null}
      </header>
      <div className="pfc-artifact-diff__body">
        {changes.flatMap((change, groupIndex) =>
          change.lines.map((line, lineIndex) => (
            <div
              className="pfc-artifact-diff__line"
              data-kind={change.kind}
              key={`${groupIndex}-${lineIndex}`}
            >
              <span aria-hidden="true">
                {change.kind === 'ADDED'
                  ? '+'
                  : change.kind === 'REMOVED'
                    ? '-'
                    : ' '}
              </span>
              <code>{line || ' '}</code>
            </div>
          )),
        )}
      </div>
    </div>
  );
}

export interface ArtifactReviewTimelineItem {
  id: string;
  conclusion: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  responsibility:
    'PRODUCT' | 'DEVELOPMENT' | 'CODE_REVIEW' | 'TEST' | 'SECURITY';
  comment: ReactNode;
  reviewer: ReactNode;
  createdAt: ReactNode;
}

const reviewLabels = {
  APPROVED: '通过',
  CHANGES_REQUESTED: '需修改',
  REJECTED: '不通过',
} as const;

const responsibilityLabels = {
  PRODUCT: '产品',
  DEVELOPMENT: '开发',
  CODE_REVIEW: '代码评审',
  TEST: '测试',
  SECURITY: '安全',
} as const;

export function ArtifactReviewTimeline({
  items,
}: {
  items: readonly ArtifactReviewTimelineItem[];
}) {
  if (!items.length) {
    return (
      <p className="pfc-artifact-collaboration-empty">当前版本暂无评审记录。</p>
    );
  }
  return (
    <ol aria-label="评审记录" className="pfc-artifact-review-timeline">
      {items.map((item) => (
        <li key={item.id}>
          <span
            aria-hidden="true"
            className="pfc-artifact-review-timeline__marker"
          />
          <div>
            <header>
              <Badge
                variant={item.conclusion === 'APPROVED' ? 'success' : 'danger'}
              >
                {reviewLabels[item.conclusion]}
              </Badge>
              <span>{responsibilityLabels[item.responsibility]}</span>
              <time>{item.createdAt}</time>
            </header>
            <p>{item.comment || '未填写评审意见'}</p>
            <small>评审人：{item.reviewer}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface ArtifactTraceListItem {
  id: string;
  direction: 'INCOMING' | 'OUTGOING';
  relation: ReactNode;
  subject: ReactNode;
  locator: ReactNode;
  validity: 'VALID' | 'INVALIDATED';
}

export function ArtifactTraceList({
  items,
}: {
  items: readonly ArtifactTraceListItem[];
}) {
  if (!items.length) {
    return (
      <p className="pfc-artifact-collaboration-empty">
        当前版本暂无已验证追溯关系。
      </p>
    );
  }
  return (
    <ul aria-label="追溯关系" className="pfc-artifact-trace-list">
      {items.map((item) => (
        <li data-validity={item.validity} key={item.id}>
          <header>
            <Badge variant={item.validity === 'VALID' ? 'success' : 'neutral'}>
              {item.validity === 'VALID' ? '有效' : '已失效'}
            </Badge>
            <span>{item.direction === 'INCOMING' ? '来源' : '去向'}</span>
            <strong>{item.relation}</strong>
          </header>
          <p>{item.subject}</p>
          <code>{item.locator}</code>
        </li>
      ))}
    </ul>
  );
}
