import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ConfirmDialog({
  actions,
  children,
  onDismiss,
  title,
}: {
  actions: ReactNode;
  children: ReactNode;
  onDismiss: () => void;
  title: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const returnTarget = document.activeElement;
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (returnTarget instanceof HTMLElement) returnTarget.focus();
    };
  }, [onDismiss]);

  return (
    <div className="pfc-confirm-layer">
      <button
        aria-label="关闭确认框"
        className="pfc-confirm__scrim"
        onClick={onDismiss}
        type="button"
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="pfc-confirm"
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="pfc-confirm__body">{children}</div>
        <div className="pfc-confirm__actions">{actions}</div>
      </section>
    </div>
  );
}
