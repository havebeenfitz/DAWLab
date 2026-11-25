import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { dismissNotice, subscribeNotices, type Notice } from '@/lib/notify';
import './Toaster.css';

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle };

/** Renders notices from lib/notify in the bottom-right corner. */
export function Toaster() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(setNotices), []);

  return (
    <div className="ui-toaster" role="region" aria-label="Notifications">
      {notices.map((n) => {
        const Icon = ICON[n.kind];
        return (
          <div key={n.id} className={`ui-toast ui-toast-${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={16} className="ui-toast-icon" aria-hidden />
            <div className="ui-toast-text">
              <strong>{n.title}</strong>
              {n.detail && <span>{n.detail}</span>}
            </div>
            <button type="button" className="ui-icon-btn" onClick={() => dismissNotice(n.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
