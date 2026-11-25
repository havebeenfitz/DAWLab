import { useState } from 'react';
import { Eye, MoreHorizontal } from 'lucide-react';
import './PreviewingBar.css';

export interface ActivePreview {
  branch: string;
  author: string;
  message: string;
  path: string;
}

interface Props {
  preview: ActivePreview | null;
  dawName: string;
  busy: boolean;
  onOpen: () => void;
  onBack: () => void;
  onMakeMain: () => void;
}

/**
 * While someone else's version is laid out for a look, the top of the details
 * column says so in a color of its own, so it is never mistaken for yours.
 */
export function PreviewingBar({ preview, dawName, busy, onOpen, onBack, onMakeMain }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!preview) return null;
  const folder = preview.path.split('/').pop();
  return (
    <div className="previewing-bar" role="status" aria-label={`Previewing ${preview.branch}`}>
      <Eye size={16} aria-hidden className="previewing-icon" />
      <div className="previewing-text">
        <strong>Previewing {preview.branch}</strong>
        <span title={`“${preview.message}” is in its own folder, “${folder}”. Your project folder is untouched.`}>
          In its own folder · yours is untouched
        </span>
      </div>
      <div className="previewing-actions">
        <button type="button" className="ui-btn" onClick={onBack} disabled={busy}>
          {busy ? 'Closing…' : 'Back to main'}
        </button>
        <button type="button" className="ui-btn previewing-primary" onClick={onMakeMain} disabled={busy}>
          Make main
        </button>
        <span className="previewing-menu-wrap">
          <button
            type="button" className="ui-btn previewing-more" aria-label="More for this preview"
            aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} disabled={busy}
          >
            <MoreHorizontal size={14} aria-hidden />
          </button>
          {menuOpen && (
            <span className="previewing-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(); }}>
                Open in {dawName}
              </button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
