import type { HTMLAttributes } from 'react';

export type BadgeVariant =
  'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  className = '',
  variant = 'neutral',
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={`pfc-badge pfc-badge--${variant} ${className}`.trim()}
    />
  );
}
