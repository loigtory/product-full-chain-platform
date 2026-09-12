import { LoaderCircle, RefreshCw, ShieldCheck, FileStack } from 'lucide-react';

import { Button, EmptyState } from '@pfc/ui';

import { timestamp } from './model.ts';

export function OperationsState({
  icon,
  title,
  description,
  onRetry,
}: {
  icon: 'gate' | 'material';
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const Icon = icon === 'gate' ? ShieldCheck : FileStack;
  return (
    <EmptyState
      action={
        onRetry ? (
          <Button
            icon={<RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />}
            onClick={onRetry}
            variant="secondary"
          >
            重新加载
          </Button>
        ) : null
      }
      className="operations-state"
      description={description}
      icon={<Icon size={30} strokeWidth={1.6} />}
      title={title}
    />
  );
}

export function LoadingRows() {
  return (
    <div aria-label="正在读取运营数据" className="list-skeleton" role="status">
      {Array.from({ length: 5 }, (_, index) => (
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

export function OperationsFreshness({
  checkedAt,
  label,
  loading,
}: {
  checkedAt: string | null;
  label: string;
  loading: boolean;
}) {
  return (
    <div aria-live="polite" className="operations-page-meta" role="status">
      <span>
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="spinning-icon"
            size={15}
            strokeWidth={1.8}
          />
        ) : (
          <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
        )}
        {loading ? '正在更新' : label}
      </span>
      <small>{checkedAt ? `更新于 ${timestamp(checkedAt)}` : '尚未读取'}</small>
    </div>
  );
}
