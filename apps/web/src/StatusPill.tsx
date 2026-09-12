import { Badge, statusLabel, type BadgeVariant } from '@pfc/ui';

function badgeVariant(value: string): BadgeVariant {
  if (['PASS', 'COMPLETED', 'CONFIRMED', 'AVAILABLE'].includes(value)) {
    return 'success';
  }
  if (['BLOCK', 'CANCELLED'].includes(value)) return 'danger';
  if (['WARN', 'UNKNOWN', 'PENDING', 'OPEN', 'ANSWERED'].includes(value)) {
    return 'warning';
  }
  if (['IN_PROGRESS', 'CURRENT', 'PROCESSING'].includes(value)) return 'info';
  return 'neutral';
}

export function StatusPill({ value }: { value: string }) {
  return (
    <Badge
      className={`status-pill status-${value.toLowerCase()}`}
      title={`原始状态：${value}`}
      variant={badgeVariant(value)}
    >
      {statusLabel(value)}
    </Badge>
  );
}
