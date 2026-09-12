import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

export function useDialogFocus<T extends HTMLElement>(
  onClose: () => void,
  active = true,
): RefObject<T | null> {
  const rootRef = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;
    const dialogRoot: HTMLElement = root;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initialFocus =
      dialogRoot.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      focusableElements(dialogRoot)[0] ??
      dialogRoot;
    initialFocus.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements(dialogRoot);
      if (elements.length === 0) {
        event.preventDefault();
        dialogRoot.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialogRoot.addEventListener('keydown', handleKeyDown);
    return () => {
      dialogRoot.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active]);

  return rootRef;
}
