/**
 * Pure helpers and constants for how Library items are labelled and imported.
 */
import logicLogo from '@/assets/logic_logo.png';
import abletonLogo from '@/assets/ableton_live_logo.png';
import flLogo from '@/assets/fl_logo.png';
import reaperLogo from '@/assets/reaper_logo.png';
import protoolsLogo from '@/assets/protools_logo.svg';
import type { DawType } from '@/components/NewProject/NewProject';
import type { Project, AudioItem } from '@/types/library';
import { getStage } from '@/lib/projectState';

export type ItemKind = 'folder' | 'project' | 'audio';
export type SelectableKind = 'project' | 'audio';
export interface ViewOrderItem { kind: ItemKind; id: string }

// Maps the DAW label returned by the main-process `detect-daw` handler to the
// DAW id the NewProject form uses to prefill its walkthrough/selection.
export const DAW_LABEL_TO_TYPE: Record<string, DawType> = {
  'Logic Pro X': 'logic',
  'Logic Pro': 'logic',
  'Ableton Live': 'ableton',
  'Ableton': 'ableton',
  'FL Studio': 'fl',
  'Reaper': 'reaper',
  'Pro Tools': 'protools',
};

// Audio extensions accepted on drop and imported as Library audio items. Kept in
// sync with the main-process AUDIO_EXTENSIONS list.
export const AUDIO_DROP_EXTENSIONS = ['.wav', '.mp3', '.aif', '.aiff', '.flac', '.m4a', '.ogg'];

export const isAudioPath = (p: string): boolean =>
  AUDIO_DROP_EXTENSIONS.includes(p.slice(p.lastIndexOf('.')).toLowerCase());

// Default project name from a dropped path: the folder/file basename with any
// known DAW project extension stripped ("Song.flp" -> "Song").
export const deriveProjectName = (p: string): string => {
  const base = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  return base.replace(/\.(logicx|flp|als|rpp|ptx)$/i, '');
};

/** localStorage key holding the manual item order of a folder (or the root). */
export const viewOrderStorageKey = (folderId: string | null): string =>
  `dawlab-order-my-projects-${folderId ?? 'root'}`;

// Short DAW label for the compact card meta line.
export const shortDaw = (daw?: string): string => {
  if (!daw || daw === 'Unknown') return '';
  if (daw.startsWith('Logic')) return 'Logic';
  if (daw.startsWith('Ableton')) return 'Ableton';
  return daw;
};

// Compact one-line summary of a project's key facets for the card.
export const projectMetaLine = (p: Project): string => {
  const parts: string[] = [];
  const stage = getStage(p.stage);
  if (stage) parts.push(stage.label);
  const daw = shortDaw(p.daw);
  if (daw) parts.push(daw);
  if (p.bpm != null && p.bpm > 0) parts.push(`${Math.round(p.bpm)} BPM`);
  if (p.trackCount != null && p.trackCount > 0) parts.push(`${p.trackCount} tracks`);
  return parts.length ? parts.join(' · ') : `${p.daw} Project`;
};

/** Upper-case extension without the dot, e.g. "WAV". */
export const audioExtLabel = (a: AudioItem): string => (a.ext || '').replace(/^\./, '').toUpperCase();

// Compact meta line for an audio item card, e.g. "Audio · WAV".
export const audioMetaLine = (a: AudioItem): string => {
  const ext = audioExtLabel(a);
  return ext ? `Audio · ${ext}` : 'Audio';
};

export const getProjectIcon = (daw?: string) => {
  if (daw === 'Logic Pro X' || daw === 'Logic Pro') return logicLogo;
  if (daw === 'Ableton Live' || daw === 'Ableton') return abletonLogo;
  if (daw === 'FL Studio') return flLogo;
  if (daw === 'Reaper') return reaperLogo;
  if (daw === 'Pro Tools') return protoolsLogo;
  return null;
};

export const formatCommitDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
};

/** "Mar 4 3:05 pm" for the list view's Last saved column, or an em dash. */
export const formatListDate = (iso?: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    : '—';
