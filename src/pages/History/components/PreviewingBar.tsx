import { Eye, ExternalLink, Undo2, Check } from 'lucide-react';
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
 * While someone else's version is laid out for a look, the whole top of the
 * project says so in a color of its own, so it is never mistaken for yours.
 */
export function PreviewingBar({ preview, dawName, busy, onOpen, onBack, onMakeMain }: Props) {
  if (!preview) return null;
  const folder = preview.path.split('/').pop();
  return (
    <div className="previewing-bar" role="status" aria-label={`Previewing ${preview.author}’s version`}>
      <Eye size={18} aria-hidden />
      <div className="previewing-text">
        <strong>Previewing {preview.author || preview.branch}’s version</strong>
        <span>“{preview.message}” is in its own folder, “{folder}”. Your project folder is untouched.</span>
      </div>
      <div className="previewing-actions">
        <button type="button" className="ui-btn ui-btn-sm" onClick={onOpen} disabled={busy}>
          <ExternalLink size={13} aria-hidden /> Open in {dawName}
        </button>
        <button type="button" className="ui-btn ui-btn-sm" onClick={onMakeMain} disabled={busy}>
          <Check size={13} aria-hidden /> Make main
        </button>
        <button type="button" className="ui-btn ui-btn-sm previewing-back" onClick={onBack} disabled={busy}>
          <Undo2 size={13} aria-hidden /> {busy ? 'Closing…' : 'Back to mine'}
        </button>
      </div>
    </div>
  );
}
