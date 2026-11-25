import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayFileButton } from '../PlayFileButton';
import { VersionChangesList } from '../VersionChangesList';
import { isPlayableAudio, type VersionAudio } from '@/hooks/useVersionAudio';

const audio = (over: Partial<VersionAudio> = {}): VersionAudio => ({ playingPath: null, loadingPath: null, error: null, toggle: vi.fn(), ...over });

describe('PlayFileButton', () => {
  it('plays and pauses audio files of the version, without opening the row', () => {
    const a = audio();
    const onRowClick = vi.fn();
    render(<div onClick={onRowClick}><PlayFileButton path="Bounces/lodge.mp3" audio={a} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Play lodge.mp3' }));
    expect(a.toggle).toHaveBeenCalledWith('Bounces/lodge.mp3');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows pause while that file plays', () => {
    render(<PlayFileButton path="Bounces/lodge.mp3" audio={audio({ playingPath: 'Bounces/lodge.mp3' })} />);
    expect(screen.getByRole('button', { name: 'Pause lodge.mp3' })).toHaveClass('is-playing');
  });

  it('renders nothing for other files or without a player', () => {
    const { container, rerender } = render(<PlayFileButton path="Song.logicx/Alternatives/000/ProjectData" audio={audio()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PlayFileButton path="x.wav" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('knows which formats play', () => {
    for (const p of ['a.wav', 'B.MP3', 'c.aif', 'd.aiff', 'e.m4a', 'f.flac', 'g.ogg']) expect(isPlayableAudio(p), p).toBe(true);
    for (const p of ['Song.als', 'x.caf', 'noext', '.wav']) expect(isPlayableAudio(p), p).toBe(false);
  });
});

describe('VersionChangesList with audio', () => {
  it('offers play on added and changed audio, not on removed files', () => {
    render(<VersionChangesList
      hasParent
      parentMessage="v1"
      audio={audio()}
      diff={{ changes: [
        { kind: 'added', path: 'Bounces/lodge.mp3' },
        { kind: 'modified', path: 'Audio Files/vox.wav' },
        { kind: 'removed', path: 'Audio Files/old.wav' },
        { kind: 'modified', path: 'Song.als' },
      ], added: 1, removed: 1, modified: 2, renamed: 0, unchanged: 0 }}
    />);
    expect(screen.getByRole('button', { name: 'Play lodge.mp3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play vox.wav' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play old.wav' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
