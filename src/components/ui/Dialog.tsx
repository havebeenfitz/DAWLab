import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  title: string;
  /** One line under the title. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** While busy the dialog can't be dismissed (Esc, backdrop, close button). */
  busy?: boolean;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one modal pattern of the app: Esc and the backdrop close it, focus moves
 * into it and stays there while it is open, and returns where it was after.
 */
export function Dialog({ open, title, subtitle, onClose, busy = false, footer, width = 'md', children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="ui-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div
        ref={panelRef}
        className={`ui-dialog ui-dialog-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ui-dialog-header">
          <div className="ui-dialog-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="ui-dialog-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}
