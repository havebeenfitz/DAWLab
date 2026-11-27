import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewBar } from '../PreviewBar';

const commit = { commit_id: 'c2', message: 'louder chorus', preview_file: 'abc', timestamp: '2', author: 'max' } as never;
const player = { isPlaying: false, handleRewind: vi.fn(), handleTogglePlay: vi.fn(), audioRef: { current: null }, progressContainerRef: { current: null } } as never;
const upload = { isDraggingFile: false, isUploadingPreview: false } as never;

describe('PreviewBar', () => {
  it('offers a labelled Compare versions button that does not toggle playback', () => {
    const onCompare = vi.fn();
    render(<PreviewBar activeCommit={commit} versionNumber={2} player={player} upload={upload} canCompare onCompare={onCompare} />);
    const button = screen.getByRole('button', { name: 'Compare versions' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect((player as { handleTogglePlay: ReturnType<typeof vi.fn> }).handleTogglePlay).not.toHaveBeenCalled();
  });

  it('explains why it is off when no other version has a preview', () => {
    render(<PreviewBar activeCommit={commit} versionNumber={2} player={player} upload={upload} canCompare={false} onCompare={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Compare versions' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Attach a preview to another version to compare them');
  });
});
