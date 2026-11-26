import { useEffect, useRef, useState } from 'react';
import { Bell, GitBranch } from 'lucide-react';
import { useVersionNotices, type VersionNotice } from './useVersionNotices';
import './NotificationBell.css';

/** "3 min ago", "2 h ago", "yesterday", or the date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Row({ n, onOpen }: { n: VersionNotice; onOpen: (id: string) => void }) {
  return (
    <button type="button" role="menuitem" className={`notice-row${n.read ? '' : ' unread'}`} onClick={() => onOpen(n.id)}>
      <span className="notice-dot" aria-hidden />
      <span className="notice-main">
        <span className="notice-title">
          <strong>{n.author}</strong> saved {n.parallel ? 'a parallel version' : 'a version'}
          {n.parallel && <GitBranch size={12} aria-hidden className="notice-fork" />}
        </span>
        <span className="notice-msg" title={n.message}>“{n.message || 'Untitled version'}”</span>
        {n.summary && <span className="notice-summary" title={n.summary}>{n.summary}</span>}
        <span className="notice-where">{n.projectName} · {n.folderName} · {ago(n.at)}</span>
      </span>
    </button>
  );
}

/** The bell in the Library header: collaborators' new versions, unread first, click to open one. */
export function NotificationBell() {
  const { feed, open, markAllRead } = useVersionNotices();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShow(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShow(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [show]);

  const label = feed.unread ? `${feed.unread} new version${feed.unread === 1 ? '' : 's'} from collaborators` : 'New versions from collaborators';
  return (
    <div className="notice-bell" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={show} onClick={() => setShow(!show)}>
        <Bell size={18} aria-hidden />
        {feed.unread > 0 && <span className="notice-count" aria-hidden>{feed.unread > 99 ? '99+' : feed.unread}</span>}
      </button>
      {show && (
        <div className="notice-panel" role="menu" aria-label="New versions">
          <div className="notice-head">
            <span>New versions</span>
            {feed.unread > 0 && <button type="button" className="notice-link" onClick={() => { void markAllRead(); }}>Mark all read</button>}
          </div>
          {feed.notices.length === 0 ? (
            <p className="notice-empty">
              {feed.folders.length
                ? 'When someone saves a version in a shared folder, it shows up here.'
                : 'Share a folder to hear when collaborators save versions.'}
            </p>
          ) : (
            <div className="notice-list">
              {feed.notices.slice(0, 40).map((n) => <Row key={n.id} n={n} onOpen={(id) => { setShow(false); void open(id); }} />)}
            </div>
          )}
          {!feed.enabled && <p className="notice-off">Notifications are off in Settings.</p>}
        </div>
      )}
    </div>
  );
}
