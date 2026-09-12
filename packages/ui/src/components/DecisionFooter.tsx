import type { HTMLAttributes, ReactNode } from 'react';

export interface DecisionFooterProps extends HTMLAttributes<HTMLElement> {
  guidance?: ReactNode;
}

export function DecisionFooter({
  children,
  className = '',
  guidance,
  ...props
}: DecisionFooterProps) {
  return (
    <footer {...props} className={`pfc-decision-footer ${className}`.trim()}>
      {guidance ? (
        <span className="pfc-decision-footer__guidance">{guidance}</span>
      ) : null}
      <div className="pfc-decision-footer__actions">{children}</div>
    </footer>
  );
}
