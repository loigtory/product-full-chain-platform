import {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

export interface DrawerProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  closeIcon: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  title: ReactNode;
}

export function Drawer({
  children,
  className = '',
  closeIcon,
  description,
  onClose,
  title,
  ...props
}: DrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const returnTarget = document.activeElement;
    drawerRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (returnTarget instanceof HTMLElement) returnTarget.focus();
    };
  }, [onClose]);

  return (
    <div className="pfc-drawer-layer">
      <button
        aria-label="关闭抽屉"
        className="pfc-drawer__scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        {...props}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`pfc-drawer ${className}`.trim()}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="pfc-drawer__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            aria-label="关闭"
            className="pfc-drawer__close"
            onClick={onClose}
            type="button"
          >
            {closeIcon}
          </button>
        </header>
        <div className="pfc-drawer__body">{children}</div>
      </aside>
    </div>
  );
}
