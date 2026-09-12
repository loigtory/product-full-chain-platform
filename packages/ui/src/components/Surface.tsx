import type { HTMLAttributes } from 'react';

export type SurfaceVariant = 'plain' | 'outlined' | 'raised';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
}

export function Surface({
  className = '',
  variant = 'plain',
  ...props
}: SurfaceProps) {
  return (
    <div
      {...props}
      className={`pfc-surface pfc-surface--${variant} ${className}`.trim()}
    />
  );
}
