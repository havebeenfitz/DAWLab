import type { ReactNode } from 'react';
import { ChevronLeft, GalleryHorizontalEnd, Settings, Share2, Headphones, Users, RefreshCw, Undo2 } from 'lucide-react';
import logo from '@/assets/logo.png';
import { ActionButton } from '@/components/ui/ActionButton';
import { dawInfo } from '@/lib/daw';
import type { ProjectAccess } from '@/hooks/useProjectAccess';
import { relativeTime, type SyncStatus } from '@/components/Sharing/hub';
import { TransferBar } from '@/components/Sharing/TransferBar';
import type { TransferProgress } from '../../../../shared/transfer-progress';

interface Props {
  projectName: string;
  alternative: string;
  daw?: string;
  isSyncing: boolean;
  showSettings: boolean;
  access: ProjectAccess;
  syncStatus?: SyncStatus;
  /** Rendered under the Alternatives button while its menu is open. */
  alternativesMenu: ReactNode;
  onBack: () => void;
  onToggleAlternatives: () => void;
  onSave: () => void;
  onOpenInDaw: () => void;
  onShare: () => void;
  onToggleSettings: () => void;
  /** Shared projects only: new versions waiting on the hub, and pulling them. */
  sync?: { incoming: number; pulling: boolean; pull: () => void; transfer?: TransferProgress | null };
  /** Files differ from the last saved version: how many, and opening the Discard dialog. */
  discard?: { count: number; open: () => void };
}

/** Top bar of a project: where you are, alternatives, and what you can do with it. */
export function HistoryHeader(p: Props) {
  const daw = dawInfo(p.daw);
  const shared = p.access.folder;
  return (
    <div className="history-header">
      {/* Where you are */}
      <div className="history-header-title">
        <button
          type="button"
          onClick={p.onBack}
          aria-label="Back to Library"
          title="Back to Library"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity no-underline text-white bg-transparent border-0 p-0 cursor-pointer"
        >
          <ChevronLeft size={18} className="text-gray-400" />
          <img src={logo} alt="" className="w-7 h-7 rounded-md" />
        </button>
        <div className="flex flex-col min-w-0">
          <h2 className="flex items-center m-0 leading-tight">
            <span className="text-white text-[17px] font-semibold truncate">{p.projectName || 'Project'}</span>
            <span className="text-[#444] mx-1.5 text-[17px] font-normal" aria-hidden>/</span>
            <span className="text-gray-400 text-[14px] font-medium whitespace-nowrap" title="Current alternative">{p.alternative || 'main'}</span>
          </h2>
          {shared && (
            <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              {p.access.isListener ? <Headphones size={12} aria-hidden /> : <Users size={12} aria-hidden />}
              {p.access.isListener ? 'Listening in' : 'Shared in'} “{shared.name}”
              {' · '}
              {p.syncStatus?.state === 'syncing' ? 'syncing…' : `synced ${relativeTime(p.syncStatus?.lastSync ?? shared.lastSync)}`}
            </span>
          )}
        </div>
        {p.isSyncing && <div className="background-sync-spinner" role="status" aria-label="Syncing" />}
      </div>

      {/* Alternatives (listeners only hear what was shared on main) */}
      {!p.showSettings && !p.access.isListener && (
        <div className="history-header-center">
          <div className="relative">
            <button
              type="button"
              onClick={p.onToggleAlternatives}
              aria-haspopup="menu"
              title="Switch or create an alternative (⌘K)"
              className="btn-pill alternatives-btn"
            >
              <GalleryHorizontalEnd size={18} aria-hidden />
              <span>Alternatives</span>
              <kbd className="ml-1 text-[11px] text-gray-500 font-sans">⌘K</kbd>
            </button>
            {p.alternativesMenu}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="history-header-actions">
        {!p.showSettings && !p.access.isListener && (
          <>
            {p.discard && p.discard.count > 0 && (
              <button
                type="button"
                className="btn-pill group px-5"
                onClick={p.discard.open}
                title={`${p.discard.count} file${p.discard.count === 1 ? '' : 's'} changed since the last save. Go back to it`}
              >
                <Undo2 size={16} aria-hidden className="text-gray-400 group-hover:text-white" />
                <span>Discard changes</span>
              </button>
            )}
            <ActionButton variant="save" onClick={p.onSave} className="btn-pill px-5">
              Save version
            </ActionButton>
            <button type="button" className="btn-pill group px-5" onClick={p.onOpenInDaw} title={`Open in ${daw.name}`}>
              <span className="text-gray-400 group-hover:text-white pill-label">Open in</span>
              {daw.logo ? <img src={daw.logo} alt={daw.name} className="w-[18px] h-[18px] object-contain" /> : <span>{daw.name}</span>}
            </button>
          </>
        )}
        {shared && p.sync && (
          <button
            type="button"
            className="btn-pill group px-5 relative"
            onClick={p.sync.pull}
            disabled={p.sync.pulling}
            aria-label={p.sync.pulling ? 'Pulling…' : p.sync.incoming > 0 ? `Pull, ${p.sync.incoming} new` : 'Pull'}
            title={p.sync.incoming > 0
              ? `${p.sync.incoming} new version${p.sync.incoming === 1 ? '' : 's'} from others. Get them and send yours`
              : 'Get everyone’s latest versions and send yours'}
          >
            <RefreshCw size={16} aria-hidden className={`text-gray-400 group-hover:text-white ${p.sync.pulling ? 'animate-spin' : ''}`} />
            <span className="pill-label">{p.sync.pulling ? 'Pulling…' : 'Pull'}</span>
            {p.sync.incoming > 0 && !p.sync.pulling && (
              <span className="ui-badge" aria-label={`${p.sync.incoming} new from others`}>{p.sync.incoming} new</span>
            )}
          </button>
        )}
        {shared && p.sync?.pulling && p.sync.transfer && <TransferBar transfer={p.sync.transfer} compact />}
        <button type="button" className="btn-pill group px-5" onClick={p.onShare} disabled={!p.projectName} aria-label={shared ? 'Sharing' : 'Share'}>
          <Share2 size={16} aria-hidden className="text-gray-400 group-hover:text-white" />
          <span className="pill-label">{shared ? 'Sharing' : 'Share'}</span>
        </button>
        {!p.access.isListener && (
          <button
            type="button"
            className="btn-pill-icon"
            onClick={p.onToggleSettings}
            aria-label={p.showSettings ? 'Back to versions' : 'Project settings'}
            aria-pressed={p.showSettings}
            title={p.showSettings ? 'Back to versions' : 'Project settings'}
          >
            <Settings size={18} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
