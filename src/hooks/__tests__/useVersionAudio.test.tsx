import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const player = vi.hoisted(() => ({
  toggleSource: vi.fn(), stop: vi.fn(), playingId: null as string | null, loadingId: null as string | null, status: null as any,
}));
vi.mock('../useLibraryPreview', () => ({ useLibraryPreview: () => player }));

import { useVersionAudio } from '../useVersionAudio';

describe('useVersionAudio', () => {
  beforeEach(() => {
    player.toggleSource.mockReset();
    player.stop.mockReset();
    player.playingId = null;
    player.status = null;
    (window.ipcRenderer.invoke as any).mockReset?.();
  });

  it('plays a file of this version through the shared player, resolving its stored copy', async () => {
    const { result } = renderHook(() => useVersionAudio('lodge', 'v2'));
    act(() => result.current.toggle('Bounces/lodge.mp3'));
    const [id, resolveUrl] = player.toggleSource.mock.calls[0];
    expect(id).toBe('lodge\u0000v2\u0000Bounces/lodge.mp3');
    (window.ipcRenderer.invoke as any).mockResolvedValueOnce('http://127.0.0.1/x');
    await expect(resolveUrl()).resolves.toBe('http://127.0.0.1/x');
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('get-version-audio-url', 'lodge', 'v2', 'Bounces/lodge.mp3');
  });

  it('reports what plays only for this version, and errors from the player', () => {
    player.playingId = 'lodge\u0000v2\u0000Bounces/lodge.mp3';
    player.status = { kind: 'error', text: 'This audio file could not be decoded.' };
    const { result, rerender } = renderHook(({ v }) => useVersionAudio('lodge', v), { initialProps: { v: 'v2' } });
    expect(result.current.playingPath).toBe('Bounces/lodge.mp3');
    expect(result.current.error).toBe('This audio file could not be decoded.');
    rerender({ v: 'v3' });
    expect(result.current.playingPath).toBeNull();
  });

  it('stops playback when the version changes, and does nothing without a version', () => {
    const { result, rerender } = renderHook(({ v }) => useVersionAudio('lodge', v), { initialProps: { v: 'v2' as string | undefined } });
    rerender({ v: 'v3' });
    expect(player.stop).toHaveBeenCalled();
    rerender({ v: undefined });
    act(() => result.current.toggle('a.wav'));
    expect(player.toggleSource).not.toHaveBeenCalled();
  });
});
