import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { useDialogFocus } from '../useDialogFocus.ts';

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label="关闭"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
