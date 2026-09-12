import type { HTMLAttributes, ReactNode } from 'react';

import { Surface } from '../components/Surface.tsx';

export interface OverviewItem {
  label: string;
  value: ReactNode;
}

export type MetricTone = 'blue' | 'orange' | 'purple' | 'red';

export interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  hint: ReactNode;
  icon: ReactNode;
  label: ReactNode;
  tone: MetricTone;
  value: ReactNode;
}

export function MetricCard({
  className = '',
  hint,
  icon,
  label,
  tone,
  value,
  ...props
}: MetricCardProps) {
  return (
    <article
      {...props}
      className={`pfc-metric-card ${className}`.trim()}
      data-tone={tone}
    >
      <span aria-hidden="true" className="pfc-metric-card__icon">
        {icon}
      </span>
      <span className="pfc-metric-card__content">
        <span className="pfc-metric-card__label">{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </span>
    </article>
  );
}

export function MetricGrid({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`pfc-metric-grid ${className}`.trim()} />;
}

export interface SummaryItem {
  label: ReactNode;
  value: ReactNode;
}

export interface SummaryPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  items: readonly SummaryItem[];
  meta?: ReactNode;
  title: ReactNode;
}

export function SummaryPanel({
  className = '',
  items,
  meta,
  title,
  ...props
}: SummaryPanelProps) {
  return (
    <section {...props} className={`pfc-summary-panel ${className}`.trim()}>
      <header className="pfc-summary-panel__header">
        <h2>{title}</h2>
        {meta ? <span>{meta}</span> : null}
      </header>
      <div className="pfc-summary-panel__items">
        {items.map((item) => (
          <span className="pfc-summary-panel__item" key={String(item.label)}>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </span>
        ))}
      </div>
    </section>
  );
}

export function SummaryGrid({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`pfc-summary-grid ${className}`.trim()} />;
}

export interface WorkPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

export function WorkPanel({
  actions,
  children,
  className = '',
  description,
  title,
  ...props
}: WorkPanelProps) {
  return (
    <section {...props} className={`pfc-work-panel ${className}`.trim()}>
      <header className="pfc-work-panel__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? (
          <div className="pfc-work-panel__actions">{actions}</div>
        ) : null}
      </header>
      <div className="pfc-work-panel__body">{children}</div>
    </section>
  );
}

export interface DetailSheetProps extends HTMLAttributes<HTMLElement> {
  ariaLabel: string;
  onDismiss: () => void;
  scrimLabel?: string;
}

export function DetailSheet({
  ariaLabel,
  children,
  className = '',
  onDismiss,
  scrimLabel = '关闭详情',
  ...props
}: DetailSheetProps) {
  return (
    <div className="pfc-detail-sheet-layer">
      <button
        aria-label={scrimLabel}
        className="pfc-detail-sheet__scrim"
        onClick={onDismiss}
        type="button"
      />
      <aside
        {...props}
        aria-label={ariaLabel}
        className={`pfc-detail-sheet ${className}`.trim()}
      >
        {children}
      </aside>
    </div>
  );
}

export interface OverviewStripProps {
  ariaLabel: string;
  className?: string;
  items: readonly OverviewItem[];
  meta?: ReactNode;
}

export function OverviewStrip({
  ariaLabel,
  className = '',
  items,
  meta,
}: OverviewStripProps) {
  return (
    <Surface
      aria-label={ariaLabel}
      className={`pfc-overview-strip ${className}`.trim()}
      role="region"
      variant="outlined"
    >
      {items.map((item) => (
        <span className="pfc-overview-strip__item" key={item.label}>
          <strong>{item.value}</strong>
          {item.label}
        </span>
      ))}
      {meta ? <span className="pfc-overview-strip__meta">{meta}</span> : null}
    </Surface>
  );
}

export function FilterToolbar({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`pfc-filter-toolbar ${className}`.trim()} />
  );
}

export function DataTableFrame({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <Surface
      {...props}
      className={`pfc-data-table-frame ${className}`.trim()}
      variant="outlined"
    />
  );
}

export interface DetailLayoutProps extends HTMLAttributes<HTMLDivElement> {
  aside: ReactNode;
  primary: ReactNode;
}

export function DetailLayout({
  aside,
  className = '',
  primary,
  ...props
}: DetailLayoutProps) {
  return (
    <div {...props} className={`pfc-detail-layout ${className}`.trim()}>
      <div className="pfc-detail-layout__primary">{primary}</div>
      <aside className="pfc-detail-layout__aside">{aside}</aside>
    </div>
  );
}

export interface InfoPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  title: ReactNode;
}

export function InfoPanel({
  actions,
  children,
  className = '',
  title,
  ...props
}: InfoPanelProps) {
  return (
    <section {...props} className={`pfc-info-panel ${className}`.trim()}>
      <header className="pfc-info-panel__header">
        <h2>{title}</h2>
        {actions ? (
          <div className="pfc-info-panel__actions">{actions}</div>
        ) : null}
      </header>
      <div className="pfc-info-panel__body">{children}</div>
    </section>
  );
}

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  title: string;
}

export function EmptyState({
  action,
  className = '',
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={`pfc-empty-state ${className}`.trim()}>
      {icon ? (
        <span aria-hidden="true" className="pfc-empty-state__icon">
          {icon}
        </span>
      ) : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="pfc-empty-state__action">{action}</div> : null}
    </div>
  );
}
