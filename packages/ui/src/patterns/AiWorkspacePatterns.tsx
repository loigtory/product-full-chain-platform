import {
  forwardRef,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';

import { Badge, type BadgeVariant } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';

export interface AgentWorkspaceShellProps extends HTMLAttributes<HTMLDivElement> {
  artifact: ReactNode;
  context: ReactNode;
  contextHeader: ReactNode;
  contextOpen?: boolean;
  evidence: ReactNode;
  globalHeader?: ReactNode;
  lifecycle: ReactNode;
  onContextDismiss?: () => void;
  preview?: boolean;
  stream: ReactNode;
}

export function AgentWorkspaceShell({
  artifact,
  className = '',
  context,
  contextHeader,
  contextOpen = false,
  evidence,
  globalHeader,
  lifecycle,
  onContextDismiss,
  preview = false,
  stream,
  ...props
}: AgentWorkspaceShellProps) {
  return (
    <div
      {...props}
      className={`pfc-agent-workspace-shell ${className}`.trim()}
      data-context-open={contextOpen || undefined}
      data-preview={preview || undefined}
    >
      {globalHeader}
      {contextHeader}
      {lifecycle}
      <main className="pfc-agent-workspace" tabIndex={-1}>
        {contextOpen && onContextDismiss ? (
          <button
            aria-label="关闭上下文"
            className="pfc-agent-workspace__context-scrim"
            onClick={onContextDismiss}
            type="button"
          />
        ) : null}
        <aside className="pfc-agent-workspace__context">{context}</aside>
        <section className="pfc-agent-workspace__stream">{stream}</section>
        <aside className="pfc-agent-workspace__artifact">{artifact}</aside>
      </main>
      {evidence}
      <div className="pfc-agent-workspace__width-warning" role="status">
        当前工作空间仅支持 1120px 及以上的桌面宽度。
      </div>
    </div>
  );
}

export interface RequirementContextMeta {
  label: string;
  tone?: BadgeVariant;
  value: ReactNode;
}

export interface RequirementContextHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  context: ReactNode;
  meta: readonly RequirementContextMeta[];
  title: ReactNode;
}

export function RequirementContextHeader({
  actions,
  className = '',
  context,
  meta,
  title,
  ...props
}: RequirementContextHeaderProps) {
  return (
    <section
      {...props}
      className={`pfc-requirement-context-header ${className}`.trim()}
    >
      <div className="pfc-requirement-context-header__identity">
        <span>{context}</span>
        <h1>{title}</h1>
      </div>
      <div
        aria-label="需求上下文摘要"
        className="pfc-requirement-context-header__meta"
      >
        {meta.map((item) => (
          <span
            className="pfc-requirement-context-header__meta-item"
            key={item.label}
          >
            <small>{item.label}</small>
            {item.tone ? (
              <Badge variant={item.tone}>{item.value}</Badge>
            ) : (
              <strong>{item.value}</strong>
            )}
          </span>
        ))}
      </div>
      {actions ? (
        <div className="pfc-requirement-context-header__actions">{actions}</div>
      ) : null}
    </section>
  );
}

export interface LifecycleRailItem {
  label: string;
  state: 'complete' | 'current' | 'upcoming' | 'blocked';
  value: string;
}

export function LifecycleRail({
  ariaLabel,
  className = '',
  items,
}: {
  ariaLabel: string;
  className?: string;
  items: readonly LifecycleRailItem[];
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`pfc-lifecycle-rail ${className}`.trim()}
    >
      <ol>
        {items.map((item) => (
          <li data-state={item.state} key={item.value}>
            <span aria-hidden="true" className="pfc-lifecycle-rail__marker" />
            <span>
              <strong>{item.value}</strong>
              <small>{item.label}</small>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface WorkspaceRegionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

function WorkspaceRegion({
  actions,
  children,
  className = '',
  description,
  title,
  ...props
}: WorkspaceRegionProps) {
  return (
    <section {...props} className={className}>
      <header className="pfc-workspace-region__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? (
          <div className="pfc-workspace-region__actions">{actions}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function ContextRail(props: WorkspaceRegionProps) {
  return (
    <WorkspaceRegion
      {...props}
      className={`pfc-context-rail ${props.className ?? ''}`.trim()}
    />
  );
}

export interface ContextGroupItem {
  label: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
}

export function ContextGroup({
  items,
  title,
}: {
  items: readonly ContextGroupItem[];
  title: ReactNode;
}) {
  return (
    <section className="pfc-context-group">
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${String(item.label)}-${index}`}>
              <span>
                <strong>{item.label}</strong>
                {item.meta ? <small>{item.meta}</small> : null}
              </span>
              {item.status}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pfc-context-group__empty">暂无绑定</p>
      )}
    </section>
  );
}

export interface WorkStreamProps extends WorkspaceRegionProps {
  composer: ReactNode;
  feedRef?: RefObject<HTMLDivElement | null>;
  onFeedScroll?: HTMLAttributes<HTMLDivElement>['onScroll'];
}

export function WorkStream({
  children,
  className = '',
  composer,
  feedRef,
  onFeedScroll,
  ...props
}: WorkStreamProps) {
  return (
    <WorkspaceRegion
      {...props}
      className={`pfc-work-stream ${className}`.trim()}
    >
      <div
        className="pfc-work-stream__feed"
        onScroll={onFeedScroll}
        ref={feedRef}
      >
        {children}
      </div>
      {composer}
    </WorkspaceRegion>
  );
}

export interface AgentComposerProps extends Omit<
  HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onSubmit: (value: string) => void;
  scope: ReactNode;
  submitLabel?: string;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'>;
  value: string;
}

export const AgentComposer = forwardRef<
  HTMLTextAreaElement,
  AgentComposerProps
>(function AgentComposer(
  {
    busy = false,
    className = '',
    disabled = false,
    label,
    onSubmit,
    scope,
    submitLabel = '发送',
    textareaProps,
    value,
    ...props
  },
  ref,
) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && !busy && value.trim()) onSubmit(value.trim());
  }

  return (
    <form
      {...props}
      className={`pfc-agent-composer ${className}`.trim()}
      onSubmit={submit}
    >
      <label>
        <span className="pfc-agent-composer__label">{label}</span>
        <textarea
          {...textareaProps}
          aria-label={label}
          disabled={disabled || busy}
          ref={ref}
          value={value}
        />
      </label>
      <footer>
        <span className="pfc-agent-composer__scope">{scope}</span>
        <Button
          disabled={disabled || !value.trim()}
          loading={busy}
          type="submit"
        >
          {submitLabel}
        </Button>
      </footer>
    </form>
  );
});

export interface WorkMessageProps extends HTMLAttributes<HTMLElement> {
  actor: 'agent' | 'user';
  label: ReactNode;
  meta?: ReactNode;
}

export function WorkMessage({
  actor,
  children,
  className = '',
  label,
  meta,
  ...props
}: WorkMessageProps) {
  return (
    <article
      {...props}
      className={`pfc-work-message ${className}`.trim()}
      data-actor={actor}
    >
      <header>
        <strong>{label}</strong>
        {meta ? <small>{meta}</small> : null}
      </header>
      <div className="pfc-work-message__body">{children}</div>
    </article>
  );
}

export interface WorkBlockProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  tone?: 'neutral' | 'proposal' | 'running' | 'unknown';
}

export function WorkBlock({
  actions,
  children,
  className = '',
  eyebrow,
  title,
  tone = 'neutral',
  ...props
}: WorkBlockProps) {
  return (
    <article
      {...props}
      className={`pfc-work-block ${className}`.trim()}
      data-tone={tone}
    >
      <header>
        <span>
          {eyebrow ? <small>{eyebrow}</small> : null}
          <strong>{title}</strong>
        </span>
        {actions}
      </header>
      <div className="pfc-work-block__body">{children}</div>
    </article>
  );
}

export function RunProgressCard(props: WorkBlockProps) {
  return <WorkBlock {...props} tone="running" />;
}

export interface ReadinessPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  description: ReactNode;
  ready: boolean;
  summary: ReactNode;
  title: ReactNode;
}

export function ReadinessPanel({
  actions,
  children,
  className = '',
  description,
  ready,
  summary,
  title,
  ...props
}: ReadinessPanelProps) {
  return (
    <article
      {...props}
      className={`pfc-readiness-panel ${className}`.trim()}
      data-ready={ready}
    >
      <header>
        <span>
          <h3>{title}</h3>
          <p>{description}</p>
        </span>
        <Badge variant={ready ? 'success' : 'warning'}>
          {ready ? '可提交' : '需补齐'}
        </Badge>
      </header>
      <div className="pfc-readiness-panel__body">{children}</div>
      <footer>
        <span>{summary}</span>
        {actions ? (
          <div className="pfc-readiness-panel__actions">{actions}</div>
        ) : null}
      </footer>
    </article>
  );
}

export interface RecoveryCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}

export function RecoveryCard({
  action,
  className = '',
  description,
  title,
  ...props
}: RecoveryCardProps) {
  return (
    <article
      {...props}
      className={`pfc-recovery-card ${className}`.trim()}
      role="alert"
    >
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action}
    </article>
  );
}

export function ArtifactCanvas(props: WorkspaceRegionProps) {
  return (
    <WorkspaceRegion
      {...props}
      className={`pfc-artifact-canvas ${props.className ?? ''}`.trim()}
    />
  );
}

export interface DiffRow {
  after: ReactNode;
  before: ReactNode;
  field: ReactNode;
}

export function VersionDiffReview({
  ariaLabel,
  rows,
}: {
  ariaLabel: string;
  rows: readonly DiffRow[];
}) {
  return (
    <div aria-label={ariaLabel} className="pfc-version-diff" role="table">
      <div className="pfc-version-diff__header" role="row">
        <span role="columnheader">字段</span>
        <span role="columnheader">当前值</span>
        <span role="columnheader">建议值</span>
      </div>
      {rows.map((row, index) => (
        <div className="pfc-version-diff__row" key={index} role="row">
          <strong role="cell">{row.field}</strong>
          <span role="cell">{row.before ?? '未填写'}</span>
          <span role="cell">{row.after ?? '未填写'}</span>
        </div>
      ))}
    </div>
  );
}

export interface ActionProposalCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  meta: ReactNode;
  title: ReactNode;
}

export function ActionProposalCard({
  actions,
  children,
  className = '',
  meta,
  title,
  ...props
}: ActionProposalCardProps) {
  return (
    <article
      {...props}
      className={`pfc-action-proposal-card ${className}`.trim()}
    >
      <header>
        <span>
          <small>待确认变更</small>
          <strong>{title}</strong>
        </span>
        <Badge variant="warning">需人工确认</Badge>
      </header>
      <div className="pfc-action-proposal-card__meta">{meta}</div>
      {children}
      {actions ? (
        <footer className="pfc-action-proposal-card__actions">{actions}</footer>
      ) : null}
    </article>
  );
}

export interface EvidenceItem {
  available: boolean;
  label: string;
  value: ReactNode;
}

export function EvidenceBar({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: readonly EvidenceItem[];
}) {
  return (
    <footer aria-label={ariaLabel} className="pfc-evidence-bar">
      {items.map((item) => (
        <span data-available={item.available} key={item.label}>
          <small>{item.label}</small>
          <strong>{item.value}</strong>
        </span>
      ))}
    </footer>
  );
}
