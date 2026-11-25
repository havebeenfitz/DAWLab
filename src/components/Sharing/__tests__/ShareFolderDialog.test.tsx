import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareFolderDialog } from '../ShareFolderDialog';
import type { SharedFolder, SyncStatus } from '../hub';
import { captureIpcEvents, emitIpc, invokeCalls, mockInvoke, remoteError, type InvokeHandler } from './ipcTestUtils';
import { bob, cleo, invite, owner, sharedFolder, spaceDetails } from './fixtures';

captureIpcEvents();

const target = { folderId: 'f1', folderName: 'Album' };

function Location() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.hash}</div>;
}

interface Opts {
  shared?: SharedFolder | null;
  syncStatus?: SyncStatus;
  routes?: Record<string, InvokeHandler>;
}

async function renderDialog({ shared = null, syncStatus, routes = {} }: Opts = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mockInvoke({
    'hub-get-settings': () => ({ hubUrl: 'https://hub.test', hasKey: true }),
    'hub-space-details': () => spaceDetails(shared!),
    'hub-list-invites': () => [],
    ...routes,
  });
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<ShareFolderDialog target={target} shared={shared} syncStatus={syncStatus} onClose={onClose} onChanged={onChanged} />}
        />
        <Route path="/settings" element={<div>Settings page</div>} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onClose, onChanged, ...utils };
}

let clipboard: { writeText: ReturnType<typeof vi.fn> };
beforeEach(() => {
  clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
});

describe('ShareFolderDialog: closed', () => {
  it('renders nothing without a target', async () => {
    mockInvoke({});
    render(
      <MemoryRouter>
        <ShareFolderDialog target={null} shared={null} onClose={() => {}} onChanged={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokeCalls('hub-get-settings')).toHaveLength(0);
  });
});

describe('ShareFolderDialog: folder not shared yet', () => {
  it('asks to connect a server first when none is set, with a way to Settings', async () => {
    const { onClose } = await renderDialog({ routes: { 'hub-get-settings': () => ({ hubUrl: '', hasKey: false }) } });
    expect(screen.getByRole('dialog', { name: 'Share “Album”' })).toBeInTheDocument();
    expect(await screen.findByText('Connect a DAWLab server first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share folder' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings#server');
  });

  it('explains sharing and shows the server when one is connected', async () => {
    await renderDialog();
    expect(await screen.findByText('Server: https://hub.test')).toBeInTheDocument();
    expect(screen.queryByText('Connect a DAWLab server first')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share folder' })).toBeEnabled();
  });

  it('Share folder calls hub-share-folder and then onChanged', async () => {
    const { onChanged } = await renderDialog({ routes: { 'hub-share-folder': () => sharedFolder() } });
    const share = await screen.findByRole('button', { name: 'Share folder' });
    await waitFor(() => expect(share).toBeEnabled());
    fireEvent.click(share);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(invokeCalls('hub-share-folder')).toEqual([['f1']]);
  });

  it('shows the error when sharing fails', async () => {
    const { onChanged } = await renderDialog({
      routes: { 'hub-share-folder': () => { throw remoteError('hub-share-folder', 'Wrong server password'); } },
    });
    const share = await screen.findByRole('button', { name: 'Share folder' });
    await waitFor(() => expect(share).toBeEnabled());
    fireEvent.click(share);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Wrong server password$/);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('Cancel closes', async () => {
    const { onClose } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShareFolderDialog: owner', () => {
  const shared = sharedFolder();

  it('shows the shared title, role and number of people', async () => {
    await renderDialog({ shared });
    expect(screen.getByRole('dialog', { name: '“Album” is shared' })).toBeInTheDocument();
    expect(screen.getByText('Owner · 3 people')).toBeInTheDocument();
    await waitFor(() => expect(invokeCalls('hub-list-invites')).toEqual([['f1']]));
  });

  it('toggles the role for new people', async () => {
    await renderDialog({ shared });
    const collab = screen.getByRole('button', { name: 'Collaborator' });
    const listener = screen.getByRole('button', { name: 'Listener' });
    expect(collab).toHaveAttribute('aria-pressed', 'true');
    expect(listener).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(listener);
    expect(listener).toHaveAttribute('aria-pressed', 'true');
    expect(collab).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Plays previews and comments/)).toBeInTheDocument();
  });

  it('creates an invite with the chosen role and shows its code', async () => {
    const created = { ...invite, role: 'listen' as const, code: 'DAWL-7KQ4-MX2P-9TRB', link: 'dawlab://join/DAWL7KQ4MX2P9TRB' };
    await renderDialog({
      shared,
      routes: {
        'hub-create-invite': () => created,
        'hub-list-invites': () => (invokeCalls('hub-create-invite').length ? [created] : []),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Listener' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByLabelText('Invite code')).toHaveTextContent('DAWL-7KQ4-MX2P-9TRB');
    expect(invokeCalls('hub-create-invite')).toEqual([['f1', 'listen', undefined, undefined]]);
    expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copy invite code/ }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('DAWL-7KQ4-MX2P-9TRB'));
    fireEvent.click(screen.getByRole('button', { name: /Copy app link/ }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('dawlab://join/DAWL7KQ4MX2P9TRB'));

    // Changing the role hides the code again, so a new invite has to be made.
    fireEvent.click(screen.getByRole('button', { name: 'Collaborator' }));
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeInTheDocument();
  });

  it('survives a clipboard that refuses', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    const created = { ...invite, code: 'CODE-CODE-CODE', link: 'dawlab://join/x' };
    await renderDialog({ shared, routes: { 'hub-create-invite': () => created } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy invite code/ }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
  });

  it('lists open invites and revokes one', async () => {
    let invites = [invite];
    await renderDialog({
      shared,
      routes: {
        'hub-list-invites': () => invites,
        'hub-revoke-invite': () => { invites = []; return true; },
      },
    });
    const section = await screen.findByRole('region', { name: 'Open invites' });
    expect(within(section).getByText(/Used 1 of 5/)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Open invites' })).not.toBeInTheDocument());
    expect(invokeCalls('hub-revoke-invite')).toEqual([['f1', 'inv1']]);
  });

  it('lists people, marks you, and lets the owner change roles', async () => {
    await renderDialog({ shared, routes: { 'hub-change-role': () => undefined } });
    const people = screen.getByRole('region', { name: 'People' });
    expect(within(people).getByText('Ann (you)')).toBeInTheDocument();
    expect(within(people).getByText('Owner')).toBeInTheDocument();
    expect(within(people).queryByLabelText('Role of Ann')).not.toBeInTheDocument();

    const select = within(people).getByLabelText('Role of Bob');
    expect(select).toHaveValue('edit');
    expect(within(people).getByLabelText('Role of cleo')).toHaveValue('listen');

    const detailsBefore = invokeCalls('hub-space-details').length;
    fireEvent.change(select, { target: { value: 'listen' } });
    await waitFor(() => expect(invokeCalls('hub-change-role')).toEqual([['f1', 'm2', 'listen']]));
    await waitFor(() => expect(invokeCalls('hub-space-details').length).toBeGreaterThan(detailsBefore));
  });

  it('asks before removing someone, then removes them', async () => {
    const { onChanged } = await renderDialog({ shared, routes: { 'hub-remove-member': () => true } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(screen.getByText('Remove Bob? Their copies stop syncing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-autofocus');
    expect(invokeCalls('hub-remove-member')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invokeCalls('hub-remove-member')).toEqual([['f1', 'm2']]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText(/Remove Bob\?/)).not.toBeInTheDocument();
  });

  it('cancelling the confirm bar does nothing', async () => {
    await renderDialog({ shared });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Remove Bob\?/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
  });

  it('Stop sharing asks, calls hub-stop-sharing, then closes', async () => {
    const { onClose, onChanged } = await renderDialog({ shared, routes: { 'hub-stop-sharing': () => true } });
    expect(screen.queryByRole('button', { name: 'Leave folder' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(screen.getByText(/Stop sharing “Album”\? Everyone loses access/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invokeCalls('hub-stop-sharing')).toEqual([['f1']]);
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the error when stopping fails', async () => {
    const { onClose } = await renderDialog({
      shared,
      routes: { 'hub-stop-sharing': () => { throw remoteError('hub-stop-sharing', 'Server unreachable'); } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unreachable');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Sync now syncs the folder, refreshes and reloads details', async () => {
    const { onChanged } = await renderDialog({ shared, routes: { 'hub-sync-space': () => shared } });
    await waitFor(() => expect(invokeCalls('hub-space-details')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(invokeCalls('hub-sync-space')).toEqual([['f1']]));
    await waitFor(() => expect(invokeCalls('hub-space-details')).toHaveLength(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('disables Sync now while a background sync runs and shows its message', async () => {
    await renderDialog({ shared, syncStatus: { folderId: 'f1', state: 'syncing', message: 'Uploading Song' } });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Uploading Song');
  });

  it('shows the last sync time', async () => {
    await renderDialog({ shared });
    expect(screen.getByRole('status')).toHaveTextContent(/^Synced 5 min ago\./);
  });

  it('shows a sync problem from status or from the folder', async () => {
    await renderDialog({ shared: sharedFolder({ lastError: 'Disk full' }) });
    expect(screen.getByRole('status')).toHaveTextContent('Last sync had a problem: Disk full');
  });

  it('shows a sync problem from the status event', async () => {
    await renderDialog({ shared, syncStatus: { folderId: 'f1', state: 'error', error: 'Token revoked' } });
    expect(screen.getByRole('status')).toHaveTextContent('Last sync had a problem: Token revoked');
  });

  it('shows progress messages for this folder only', async () => {
    await renderDialog({ shared });
    act(() => { emitIpc('hub-sync-progress', { key: 'f1', message: 'Uploading 1 of 3' }); });
    expect(screen.getByRole('status')).toHaveTextContent('Uploading 1 of 3');
    act(() => { emitIpc('hub-sync-progress', { key: 'other', message: 'Nope' }); });
    expect(screen.getByRole('status')).toHaveTextContent('Uploading 1 of 3');
  });

  it('shows an error when details cannot be loaded', async () => {
    await renderDialog({ shared, routes: { 'hub-space-details': () => { throw remoteError('hub-space-details', 'Not a member'); } } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Not a member$/);
  });

  it('shows an error when creating an invite fails', async () => {
    await renderDialog({ shared, routes: { 'hub-create-invite': () => { throw remoteError('hub-create-invite', 'Only the owner can invite'); } } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can invite');
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeEnabled();
  });

  it('Done closes', async () => {
    const { onClose } = await renderDialog({ shared });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShareFolderDialog: member', () => {
  const shared = sharedFolder({ role: 'edit', memberId: 'm2' });

  it('has no invite section, no role controls, and does not load invites', async () => {
    await renderDialog({ shared });
    expect(screen.getByText('Collaborator · 3 people')).toBeInTheDocument();
    await waitFor(() => expect(invokeCalls('hub-space-details')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Invite people' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Role of/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).not.toBeInTheDocument();
    expect(screen.getByText('Bob (you)')).toBeInTheDocument();
    expect(invokeCalls('hub-list-invites')).toHaveLength(0);
  });

  it('Leave folder asks, calls hub-leave-space, then closes', async () => {
    const { onClose, onChanged } = await renderDialog({ shared, routes: { 'hub-leave-space': () => true } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave folder' }));
    expect(screen.getByText(/Leave “Album”\? Your copies stay on this Mac/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invokeCalls('hub-leave-space')).toEqual([['f1']]);
    expect(onChanged).toHaveBeenCalled();
  });

  it('Sync now works for members too', async () => {
    await renderDialog({ shared, routes: { 'hub-sync-space': () => shared } });
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(invokeCalls('hub-sync-space')).toEqual([['f1']]));
  });

  it('says 1 person when alone', async () => {
    await renderDialog({ shared: sharedFolder({ role: 'listen', memberId: 'm3', members: [cleo] }) });
    expect(screen.getByText('Listener · 1 person')).toBeInTheDocument();
  });

  it('uses details members over the cached list', async () => {
    const local = sharedFolder({ role: 'edit', memberId: 'm2', members: [owner, bob] });
    await renderDialog({ shared: local, routes: { 'hub-space-details': () => spaceDetails(local, { members: [owner, bob, cleo] }) } });
    expect(await screen.findByText('cleo')).toBeInTheDocument();
    expect(screen.getByText('Collaborator · 3 people')).toBeInTheDocument();
  });
});
