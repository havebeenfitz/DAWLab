import { Music, AudioLines } from 'lucide-react';
import { QuickLook } from '@/components/QuickLook';
import type { QuickLookDetail } from '@/components/QuickLook';
import { getStage } from '@/lib/projectState';
import type { Project, AudioItem } from '@/types/library';
import { formatCommitDate, getProjectIcon, shortDaw } from '../libraryDisplay';

interface PlaybackProps {
  playingId: string | null;
  loadingId: string | null;
  pause: () => void;
  onSeek: (time: number) => void;
  getElement: () => HTMLAudioElement | null;
  onClose: () => void;
}

/** Key facts of a project for its Quick Look panel. */
function projectDetails(p: Project): QuickLookDetail[] {
  return [
    getStage(p.stage) && { label: 'Stage', value: getStage(p.stage)!.label },
    !!p.openTasks && { label: 'Open tasks', value: String(p.openTasks) },
    shortDaw(p.daw) && { label: 'DAW', value: shortDaw(p.daw) },
    p.bpm != null && p.bpm > 0 && { label: 'BPM', value: String(Math.round(p.bpm)) },
    p.trackCount != null && p.trackCount > 0 && { label: 'Tracks', value: String(p.trackCount) },
  ].filter((d): d is QuickLookDetail => !!d);
}

export function ProjectQuickLook({ project, play, ...pb }: PlaybackProps & { project: Project; play: (p: Project) => unknown }) {
  const icon = getProjectIcon(project.daw);
  return (
    <QuickLook
      title={project.name}
      icon={icon
        ? <img src={icon} alt={project.daw} />
        : <Music size={72} />}
      details={projectDetails(project)}
      commit={project.previewCommitId ? {
        id: project.previewCommitId,
        message: project.previewCommitMessage ?? null,
        date: formatCommitDate(project.previewCommitTimestamp),
      } : undefined}
      isPlaying={pb.playingId === project.id}
      isLoading={pb.loadingId === project.id}
      onTogglePlay={() => (pb.playingId === project.id ? pb.pause() : play(project))}
      onSeek={pb.onSeek}
      getElement={pb.getElement}
      onClose={pb.onClose}
    />
  );
}

export function AudioQuickLook({ audio, play, ...pb }: PlaybackProps & { audio: AudioItem; play: (a: AudioItem) => unknown }) {
  const added = formatCommitDate(audio.addedAt);
  return (
    <QuickLook
      title={audio.name}
      icon={<AudioLines size={72} />}
      details={[
        { label: 'Format', value: (audio.ext || '').replace(/^\./, '').toUpperCase() || 'Audio' },
        ...(added ? [{ label: 'Added', value: added }] : []),
      ]}
      isPlaying={pb.playingId === audio.id}
      isLoading={pb.loadingId === audio.id}
      onTogglePlay={() => (pb.playingId === audio.id ? pb.pause() : play(audio))}
      onSeek={pb.onSeek}
      getElement={pb.getElement}
      onClose={pb.onClose}
    />
  );
}
