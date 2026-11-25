import { motion } from 'motion/react';
import { FileExplorer } from '@/components/FileExplorer/FileExplorer';
import { PluginSection } from '@/components/PluginSection/PluginSection';
import { VersionComments } from '@/components/Feedback/VersionComments';
import { useVersionChanges } from '@/hooks/useVersionChanges';

export type BottomPanelTab = 'files' | 'plugins' | 'comments';

const TABS: Array<{ id: BottomPanelTab; label: string }> = [
  { id: 'files', label: 'Files' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'comments', label: 'Comments' },
];

interface Props {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  projectName: string;
  /** Version shown in the file explorer. */
  fileCommitId: string | undefined;
  projectPath: string | null;
  onSelectPath: () => void;
  plugins: any[];
  /** Version whose comments are shown; null when none is active. */
  commentsCommitId: string | null;
  /** Changes when entering/leaving full screen, to remount the comments panel. */
  commentsKey: string;
  username: string;
  currentTime: number;
  onPlayFrom: (seconds: number) => void;
}

/** Tab picker shown below 1100px, where only one panel is visible at a time. */
function MobileTabPicker({ activeTab, onTabChange }: Pick<Props, 'activeTab' | 'onTabChange'>) {
  return (
    <div className="mb-8 min-[1100px]:hidden">
      <div className="flex gap-8 relative">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`pb-4 text-base font-medium transition-colors relative z-10 !bg-transparent !border-none !p-0 !rounded-none ${
              activeTab === id ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
            {activeTab === id && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0094FF] shadow-[0_0_8px_rgba(0,148,255,0.5)]"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Classes for one panel: always shown from 1100px up, otherwise only when its tab is active. */
const panelClass = (active: boolean, scrolls: boolean) =>
  `flex-1 min-h-0 ${active ? 'flex flex-col' : 'hidden'} min-[1100px]:flex min-[1100px]:flex-col${scrolls ? ' overflow-y-auto' : ''}`;

/** Files, plugins and comments of the active version: side by side on desktop, tabbed on mobile. */
export function HistoryBottomPanels(p: Props) {
  const { changes, loading: changesLoading } = useVersionChanges(p.projectName, p.fileCommitId);
  return (
    <div className="flex flex-col flex-1 min-h-0 px-6">
      <MobileTabPicker activeTab={p.activeTab} onTabChange={p.onTabChange} />

      <div className="bottom-panels flex flex-col min-[1100px]:flex-row gap-8 flex-1 min-h-0">
        <div className={panelClass(p.activeTab === 'files', true)}>
          <FileExplorer
            projectName={p.projectName}
            commitId={p.fileCommitId}
            projectPath={p.projectPath}
            onSelectPath={p.onSelectPath}
            changes={changes}
            changesLoading={changesLoading}
          />
        </div>

        <div className={panelClass(p.activeTab === 'plugins', true)}>
          <PluginSection plugins={changes?.plugins ? changes.plugins.changes.filter(c => c.kind !== 'removed').map(c => c.plugin) : p.plugins} changes={changes?.plugins ?? null} />
        </div>

        {/* Comments on the active version (Tasks + Notepad are hidden for now) */}
        <div className={panelClass(p.activeTab === 'comments', false)}>
          <VersionComments
            // Remount on entering/leaving full screen: flushes this panel's
            // pending save before the overlay loads, and reloads after it.
            key={p.commentsKey}
            projectName={p.projectName}
            // Every version can be discussed; without a preview, comments simply have no time position.
            commitId={p.commentsCommitId}
            username={p.username}
            currentTime={p.currentTime}
            onPlayFrom={p.onPlayFrom}
          />
        </div>
      </div>
    </div>
  );
}
