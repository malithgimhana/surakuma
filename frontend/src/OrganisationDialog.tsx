import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Minus, X } from 'lucide-react';
import { Button } from './components';

export function WorkspaceDialog({ title, context, busy, onDismiss, minimize, children, className = '' }: {
  title: string;
  context?: ReactNode;
  busy?: boolean;
  onDismiss: () => void;
  minimize?: { label: string; onClick: () => void };
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`organisation-dialog ${className}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
    >
      <header className="organisation-dialog-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {context && <p className="muted">{context}</p>}
        </div>
        <div className="inline">
          {minimize && (
            <Button type="button" variant="ghost" aria-label={minimize.label} title={minimize.label} disabled={busy} onClick={minimize.onClick}>
              <Minus size={18} aria-hidden="true" />
            </Button>
          )}
          <Button type="button" variant="ghost" aria-label="Close dialog" disabled={busy} onClick={onDismiss}>
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
      </header>
      {children}
    </dialog>
  );
}

export const OrganisationDialog = WorkspaceDialog;
