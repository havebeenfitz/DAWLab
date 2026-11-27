import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invokeCalls, mockInvoke, remoteError } from '@/components/Sharing/__tests__/ipcTestUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedFolder, SyncStatus } from '@/components/Sharing';
import { sharedFolder, owner, bob, cleo } from '@/components/Sharing/__tests__/fixtures';
import { SharedFolderBar } from '../SharedFolderBar';

const sharing = vi.hoisted(() => ({
  value: {
    folders: {} as Record<string, SharedFolder>,
    status: {} as Record<string, SyncStatus>,
    refresh: vi.fn(),
    shareFolder: vi.fn(),
    shareProject: vi.fn(),
    join: vi.fn(),
    syncNow: vi.fn(),
    forceStopSync: vi.fn(),
  },
}));

vi.mock('@/components/Sharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Sharing')>()),
  useSharing: () => sharing.value,
}));

const bar = () => screen.getByRole('region', { name: 'Shared folder' });

beforeEach(() => {
  sharing.value.folders = { f1: sharedFolder() };
  sharing.value.status = {};
  sharing.value.shareFolder.mockReset();
});

describe('SharedFolderBar', () => {
  it('renders nothing for a folder that is not shared', () => {
    const { container } = render(<SharedFolderBar folderId="nope" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the name, members and role', () => {
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Album');
    const avatars = screen.getByLabelText('3 people');
    expect(Array.from(avatars.children).map((c) => c.textContent)).toEqual(['A', 'B', 'C']);
    expect(avatars.children[2]).toHaveAttribute('title', 'cleo · Listener');
    expect(bar()).toHaveTextContent('Owner ·');
  });

  it('shows at most five avatars but counts everyone', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...bob, id: `m${i}`, name: `P${i}` }));
    sharing.value.folders = { f1: sharedFolder({ members: many }) };
    render(<SharedFolderBar folderId="f1" />);
    expect(screen.getByLabelText('7 people').children).toHaveLength(5);
  });

  it('offers Force stop only while syncs loop or hang', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'syncing', message: 'Syncing Snow...' } };
    const { rerender } = render(<SharedFolderBar folderId="f1" />);
    expect(screen.queryByRole('button', { name: 'Force stop' })).toBeNull();

    sharing.value.status = { f1: { folderId: 'f1', state: 'synced', trouble: 'looping' } };
    rerender(<SharedFolderBar folderId="f1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Syncing keeps starting over');
    fireEvent.click(screen.getByRole('button', { name: 'Force stop' }));
    expect(sharing.value.forceStopSync).toHaveBeenCalledWith('f1');

    sharing.value.status = { f1: { folderId: 'f1', state: 'syncing', trouble: 'stuck' } };
    rerender(<SharedFolderBar folderId="f1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Syncing hasn’t moved for 2 minutes');
    expect(screen.getByRole('button', { name: 'Force stop' })).toBeInTheDocument();
  });

  it('says a stopped folder waits for Sync now', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'paused' } };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Sync stopped. Press Sync now to try again.');
    expect(screen.queryByRole('button', { name: 'Force stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  });

  it('owners get "Invite & manage", which opens the folder dialog', () => {
    render(<SharedFolderBar folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite & manage' }));
    expect(sharing.value.shareFolder).toHaveBeenCalledWith('f1', 'Album');
  });

  it('members get "People"', () => {
    sharing.value.folders = { f1: sharedFolder({ role: 'edit', memberId: 'm2' }) };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Collaborator ·');
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    expect(sharing.value.shareFolder).toHaveBeenCalledWith('f1', 'Album');
  });

  it('tells listeners what they can do', () => {
    sharing.value.folders = { f1: sharedFolder({ role: 'listen', members: [owner, cleo] }) };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Listener · you can play previews ·');
    expect(bar().querySelector('svg')).toHaveClass('lucide-headphones');
  });

  it('shows when it last synced', () => {
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('synced 5 min ago');
  });

  it('prefers the live sync time', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'synced', lastSync: new Date().toISOString() } };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('synced just now');
  });

  it('shows sync progress and a spinner while syncing', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'syncing', message: 'Downloading Song' } };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Downloading Song');
    expect(screen.getByRole('button', { name: 'Syncing…' }).querySelector('.animate-spin')).not.toBeNull();
  });

  it('says Syncing… without a message', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'syncing' } };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Syncing…');
  });

  it('shows the error of a failed sync', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'error', error: 'Server unreachable' } };
    render(<SharedFolderBar folderId="f1" />);
    expect(screen.getByText('Server unreachable')).toHaveClass('ui-status-error');
  });

  it('shows the stored error when there is no live status', () => {
    sharing.value.folders = { f1: sharedFolder({ lastError: 'Token revoked' }) };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).toHaveTextContent('Token revoked');
    expect(bar()).not.toHaveTextContent('synced');
  });

  it('a successful live sync hides the stored error', () => {
    sharing.value.folders = { f1: sharedFolder({ lastError: 'Token revoked' }) };
    sharing.value.status = { f1: { folderId: 'f1', state: 'synced', lastSync: new Date().toISOString() } };
    render(<SharedFolderBar folderId="f1" />);
    expect(bar()).not.toHaveTextContent('Token revoked');
    expect(bar()).toHaveTextContent('synced just now');
  });

  it('syncs the folder now, and is disabled while a sync runs', () => {
    render(<SharedFolderBar folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(sharing.value.syncNow).toHaveBeenCalledWith('f1');
  });

  it('shows Syncing… while syncing', () => {
    sharing.value.status = { f1: { folderId: 'f1', state: 'syncing' } };
    render(<SharedFolderBar folderId="f1" />);
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  });

  describe('when access was closed (removed, or the owner stopped sharing)', () => {
    beforeEach(() => {
      sharing.value.folders = { f1: sharedFolder({ role: 'edit', accessClosed: true, lastError: 'You no longer have access' }) };
      sharing.value.join.mockReset();
      sharing.value.refresh.mockReset();
    });

    it('says so plainly and that the copies are still here, instead of a sync error', () => {
      render(<SharedFolderBar folderId="f1" />);
      expect(bar()).toHaveTextContent('Access to “Album” was closed. Your copies are still on this Mac.');
      expect(bar()).not.toHaveTextContent('You no longer have access');
      expect(screen.queryByRole('button', { name: /Sync now/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /People|Invite/ })).not.toBeInTheDocument();
    });

    it('Enter a new code opens the join dialog', () => {
      render(<SharedFolderBar folderId="f1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Enter a new code' }));
      expect(sharing.value.join).toHaveBeenCalledWith();
    });

    it('Stop syncing this folder forgets the share and keeps the folder', async () => {
      mockInvoke({ 'hub-leave-space': () => true });
      render(<SharedFolderBar folderId="f1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Stop syncing this folder' }));
      await waitFor(() => expect(sharing.value.refresh).toHaveBeenCalled());
      expect(invokeCalls('hub-leave-space')).toEqual([['f1']]);
    });

    it('explains when stopping fails, and lets you try again', async () => {
      mockInvoke({ 'hub-leave-space': () => { throw remoteError('hub-leave-space', 'Disk full'); } });
      render(<SharedFolderBar folderId="f1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Stop syncing this folder' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
      expect(screen.getByRole('button', { name: 'Stop syncing this folder' })).toBeEnabled();
      expect(sharing.value.refresh).not.toHaveBeenCalled();
    });
  });
});
