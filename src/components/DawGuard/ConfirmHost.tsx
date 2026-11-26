import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { subscribeConfirm, type ConfirmRequest } from '@/lib/confirm';

/** Shows the question asked with askConfirm(). */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeConfirm(setReq), []);
  if (!req) return null;
  return (
    <Dialog
      open
      width="md"
      title={req.title}
      onClose={() => req.resolve(false)}
      footer={
        <>
          <button type="button" className="ui-btn" data-autofocus onClick={() => req.resolve(false)}>{req.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={`ui-btn ${req.danger ? 'ui-btn-danger' : 'ui-btn-primary'}`} onClick={() => req.resolve(true)}>{req.confirmLabel}</button>
        </>
      }
    >
      <p className="ui-hint">{req.message}</p>
      {req.items && req.items.length > 0 && (
        <ul className="confirm-items">
          {req.items.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </Dialog>
  );
}
