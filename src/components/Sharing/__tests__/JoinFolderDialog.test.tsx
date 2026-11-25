import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JoinFolderDialog } from '../JoinFolderDialog';
import type { InvitePreview } from '../hub';
import { captureIpcEvents, emitIpc, invokeCalls, mockInvoke, remoteError, type InvokeHandler } from './ipcTestUtils';

captureIpcEvents();

const CODE = 'DAWL-7KQ4-MX2P-9TRB';
const LEGACY = 'https://hub.test/s/AbCdEfGhIjKlMnOpQrStUv';

const preview: InvitePreview = {
  hubUrl: 'https://hub.test',
  space: { id: 's1', name: 'Album' },
  role: 'listen',
  invitedBy: 'Ann',
  projectCount: 3,
  memberCount: 1,
  expiresAt: '2026-12-31T00:00:00Z',
};

async function renderJoin(prefill: string | null = '', routes: Record<string, InvokeHandler> = {}) {
  const onClose = vi.fn();
  const onJoined = vi.fn();
  mockInvoke({
    'hub-default-join-dir': () => '/Users/me/Music/DAWLab',
    'hub-preview-invite': () => preview,
    ...routes,
  });
  const utils = render(<JoinFolderDialog prefill={prefill} onClose={onClose} onJoined={onJoined} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onClose, onJoined, ...utils };
}

const inviteInput = () => screen.getByLabelText('Invite');
const joinButton = () => screen.getByRole('button', { name: 'Join' });
const type = (value: string) => fireEvent.change(inviteInput(), { target: { value } });

describe('JoinFolderDialog', () => {
  it('is closed when prefill is null', async () => {
    await renderJoin(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokeCalls('hub-default-join-dir')).toHaveLength(0);
  });

  it('opens with an empty field and focuses it', async () => {
    await renderJoin('');
    expect(screen.getByRole('dialog', { name: 'Join a shared folder' })).toBeInTheDocument();
    expect(inviteInput()).toHaveValue('');
    expect(inviteInput()).toHaveFocus();
    expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
  });

  it('fills in the default folder from the main process', async () => {
    await renderJoin('');
    expect(screen.getByLabelText('Save projects in')).toHaveValue('/Users/me/Music/DAWLab');
  });

  it('keeps the folder empty when there is no default', async () => {
    await renderJoin('', { 'hub-default-join-dir': () => { throw new Error('no'); } });
    expect(screen.getByLabelText('Save projects in')).toHaveValue('');
  });

  it('prefills the field and previews the invite right away', async () => {
    await renderJoin('dawlab://join/DAWL7KQ4MX2P9TRB');
    expect(inviteInput()).toHaveValue('dawlab://join/DAWL7KQ4MX2P9TRB');
    expect(await screen.findByText('Album')).toBeInTheDocument();
    expect(invokeCalls('hub-preview-invite')).toEqual([['dawlab://join/DAWL7KQ4MX2P9TRB']]);
  });

  it('previews a typed code after a pause and shows what it opens', async () => {
    await renderJoin('');
    type(CODE);
    expect(screen.getByRole('status')).toHaveTextContent('Checking the invite…');
    expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
    expect(await screen.findByText('Album')).toBeInTheDocument();
    expect(invokeCalls('hub-preview-invite')).toEqual([[CODE]]);
    expect(screen.getByText('Shared by Ann · 3 projects · 1 person')).toBeInTheDocument();
    expect(screen.getByText('You join as listener: plays previews and comments.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });

  it('previews only the last of quickly typed values', async () => {
    await renderJoin('');
    type('DAWL-7KQ4-MX2P');
    type(CODE);
    await screen.findByText('Album');
    expect(invokeCalls('hub-preview-invite')).toEqual([[CODE]]);
  });

  it('does not preview text that is too short to be an invite', async () => {
    vi.useFakeTimers();
    try {
      await renderJoinFake('');
      type('abc-123');
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
      expect(screen.getByRole('status')).toHaveTextContent(/^$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits 350 ms before previewing', async () => {
    vi.useFakeTimers();
    try {
      await renderJoinFake('');
      type(CODE);
      await act(async () => { vi.advanceTimersByTime(349); });
      expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(invokeCalls('hub-preview-invite')).toEqual([[CODE]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows why an invite is not valid and keeps Join disabled', async () => {
    await renderJoin('', { 'hub-preview-invite': () => { throw remoteError('hub-preview-invite', 'This invite has expired.'); } });
    type(CODE);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^This invite has expired\.$/);
    expect(joinButton()).toBeDisabled();
  });

  it('clears the error and preview when the text is edited away', async () => {
    await renderJoin('', { 'hub-preview-invite': () => { throw remoteError('hub-preview-invite', 'Unknown invite'); } });
    type(CODE);
    await screen.findByRole('alert');
    type('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps Join disabled until there is a preview and a folder', async () => {
    await renderJoin('', { 'hub-default-join-dir': () => '' });
    expect(joinButton()).toBeDisabled();
    type(CODE);
    await screen.findByText('Album');
    expect(joinButton()).toBeDisabled(); // no folder yet

    mockInvoke({ 'pick-folder': () => '/Volumes/Work', 'hub-preview-invite': () => preview });
    fireEvent.click(screen.getByRole('button', { name: /Choose…/ }));
    await waitFor(() => expect(screen.getByLabelText('Save projects in')).toHaveValue('/Volumes/Work'));
    expect(joinButton()).toBeEnabled();
  });

  it('Choose… keeps the folder when the picker is cancelled', async () => {
    await renderJoin('', { 'pick-folder': () => null });
    fireEvent.click(screen.getByRole('button', { name: /Choose…/ }));
    await waitFor(() => expect(invokeCalls('pick-folder')).toHaveLength(1));
    expect(screen.getByLabelText('Save projects in')).toHaveValue('/Users/me/Music/DAWLab');
  });

  it('clicking the folder field opens the picker too', async () => {
    await renderJoin('', { 'pick-folder': () => '/tmp/x' });
    fireEvent.click(screen.getByLabelText('Save projects in'));
    await waitFor(() => expect(screen.getByLabelText('Save projects in')).toHaveValue('/tmp/x'));
  });

  it('joins with the typed invite and the folder, then reports the folder id', async () => {
    const { onJoined } = await renderJoin('', {
      'hub-join-space': () => ({ folderId: 'lib-folder-9', addedProjects: ['A'], failed: [] }),
    });
    type(CODE);
    await screen.findByText('Album');
    fireEvent.click(joinButton());
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('lib-folder-9'));
    expect(invokeCalls('hub-join-space')).toEqual([[CODE, '/Users/me/Music/DAWLab']]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows "Joining…" and progress while joining', async () => {
    let finish: (v: unknown) => void = () => {};
    await renderJoin('', { 'hub-join-space': () => new Promise((r) => { finish = r; }) });
    type(CODE);
    await screen.findByText('Album');
    fireEvent.click(joinButton());
    expect(await screen.findByRole('button', { name: 'Joining…' })).toBeDisabled();
    expect(inviteInput()).toBeDisabled();
    act(() => { emitIpc('hub-sync-progress', { key: 'join', message: 'Downloading Song 1 of 3' }); });
    expect(screen.getByRole('status')).toHaveTextContent('Downloading Song 1 of 3');
    // Esc does nothing while busy.
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { finish({ folderId: 'f', addedProjects: [], failed: [] }); });
  });

  it('tells you when some projects could not be downloaded, and still joins', async () => {
    const { onJoined } = await renderJoin('', {
      'hub-join-space': () => ({ folderId: 'f9', addedProjects: [], failed: [{ project: 'Song B', error: 'timeout' }] }),
    });
    type(CODE);
    await screen.findByText('Album');
    fireEvent.click(joinButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Joined, but 1 project(s) could not be downloaded yet: Song B. DAWLab will retry.');
    expect(onJoined).toHaveBeenCalledWith('f9');
  });

  it('shows the error when joining fails', async () => {
    const { onJoined } = await renderJoin('', {
      'hub-join-space': () => { throw remoteError('hub-join-space', 'A folder named “Album” already exists there.'); },
    });
    type(CODE);
    await screen.findByText('Album');
    fireEvent.click(joinButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('A folder named “Album” already exists there.');
    expect(onJoined).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it('recognises a legacy single-project link without previewing it', async () => {
    const listener = vi.fn();
    window.addEventListener('dawlab:library-changed', listener);
    const { onClose, onJoined } = await renderJoin('', { 'hub-open-shared': () => ({ success: true }) });
    type(LEGACY);
    expect(screen.getByText('Link to a single project')).toBeInTheDocument();
    expect(joinButton()).toBeEnabled();

    fireEvent.click(joinButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invokeCalls('hub-open-shared')).toEqual([[LEGACY, '/Users/me/Music/DAWLab']]);
    expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
    expect(invokeCalls('hub-join-space')).toHaveLength(0);
    expect(onJoined).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('dawlab:library-changed', listener);
  });

  it('shows the error when opening a legacy link fails', async () => {
    const { onClose } = await renderJoin(LEGACY, { 'hub-open-shared': () => { throw remoteError('hub-open-shared', 'Link revoked'); } });
    fireEvent.click(joinButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Link revoked');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes', async () => {
    const { onClose } = await renderJoin('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets when reopened with a new prefill', async () => {
    const { rerender } = await renderJoin('');
    type(CODE);
    await screen.findByText('Album');
    const onClose = vi.fn();
    rerender(<JoinFolderDialog prefill={null} onClose={onClose} onJoined={vi.fn()} />);
    rerender(<JoinFolderDialog prefill="" onClose={onClose} onJoined={vi.fn()} />);
    expect(inviteInput()).toHaveValue('');
    expect(screen.queryByText('Album')).not.toBeInTheDocument();
  });
});

/** renderJoin for fake timers: flushes promises without waiting on a real timer. */
async function renderJoinFake(prefill: string) {
  mockInvoke({ 'hub-default-join-dir': () => '/d', 'hub-preview-invite': () => preview });
  render(<JoinFolderDialog prefill={prefill} onClose={vi.fn()} onJoined={vi.fn()} />);
  await act(async () => { await Promise.resolve(); });
}

// Edits that turn the field back into something that is not an invite while a
// check is pending. The effect returns early for non-invites without bumping
// `seq` or clearing `checking`.
describe('JoinFolderDialog: editing during a pending check', () => {
  it('regression: "Checking the invite…" is not left on screen after deleting the code before the debounce fires', async () => {
    vi.useFakeTimers();
    try {
      await renderJoinFake('');
      type(CODE);
      await act(async () => { vi.advanceTimersByTime(100); });
      type('abc');
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(invokeCalls('hub-preview-invite')).toHaveLength(0);
      expect(screen.getByRole('status')).not.toHaveTextContent('Checking the invite…');
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression: a preview that arrives after the code was edited to a non-invite is not shown and does not enable Join', async () => {
    let resolvePreview: (p: InvitePreview) => void = () => {};
    const onJoined = vi.fn();
    mockInvoke({
      'hub-default-join-dir': () => '/d',
      'hub-preview-invite': () => new Promise<InvitePreview>((r) => { resolvePreview = r; }),
      'hub-join-space': () => ({ folderId: 'f', addedProjects: [], failed: [] }),
    });
    render(<JoinFolderDialog prefill="" onClose={vi.fn()} onJoined={onJoined} />);
    type(CODE);
    await waitFor(() => expect(invokeCalls('hub-preview-invite')).toHaveLength(1));
    type('abc');
    await act(async () => { resolvePreview(preview); });
    expect(screen.queryByText('Album')).not.toBeInTheDocument();
    expect(joinButton()).toBeDisabled();
  });
});
