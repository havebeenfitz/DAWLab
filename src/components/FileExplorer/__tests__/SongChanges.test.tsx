import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SongChanges } from '../SongChanges';

const song = { tempo: 90, tracks: 48, key: 'D minor', timeSignature: '4/4', sampleRate: 48000 };

describe('SongChanges', () => {
  it('shows the song facts in one line', () => {
    render(<SongChanges song={song} diff={null} />);
    expect(screen.getByText('90 BPM · 48 tracks · D minor · 4/4 · 48 kHz')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lists song changes and audio files added and removed, like a diff', () => {
    render(<SongChanges song={song} diff={{
      changes: [{ field: 'tempo', label: 'Tempo', before: '86 BPM', after: '90 BPM' }, { field: 'tracks', label: 'Tracks', before: '46', after: '48' }],
      audioAdded: ['Audio Files/new vox.wav'],
      audioRemoved: ['Audio Files/old take.wav'],
    }} />);
    expect(screen.getByText('Tempo: 86 BPM → 90 BPM')).toBeInTheDocument();
    expect(screen.getByText('Tracks: 46 → 48')).toBeInTheDocument();
    expect(screen.getByText('Audio Files/new vox.wav').previousSibling).toHaveTextContent('+');
    expect(screen.getByText('Audio Files/old take.wav').previousSibling).toHaveTextContent('−');
  });

  it('says so when nothing is known, and handles a single track', () => {
    const { rerender } = render(<SongChanges song={{}} diff={null} />);
    expect(screen.getByText('No song details')).toBeInTheDocument();
    rerender(<SongChanges song={{ tracks: 1 }} diff={{ changes: [], audioAdded: [], audioRemoved: [] }} />);
    expect(screen.getByText('1 track')).toBeInTheDocument();
  });
});
