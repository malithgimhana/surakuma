import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './components';

export const organisationIdPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function WorkspaceDialog({ title, context, busy, onDismiss, children, className = '' }: {
  title: string;
  context?: string;
  busy?: boolean;
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
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
        <Button type="button" variant="ghost" aria-label="Close dialog" disabled={busy} onClick={onDismiss}>
          <X size={20} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}

export const OrganisationDialog = WorkspaceDialog;
