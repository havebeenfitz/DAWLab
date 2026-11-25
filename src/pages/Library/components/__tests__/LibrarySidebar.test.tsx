import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@/types/library';
import type { SharedFolder, SyncStatus } from '@/components/Sharing';
import { sharedFolder, owner, bob } from '@/components/Sharing/__tests__/fixtures';
import { LibrarySidebar } from '../LibrarySidebar';

const sharing = vi.hoisted(() => ({
  value: {
    folders: {} as Record<string, SharedFolder>,
    status: {} as Record<string, SyncStatus>,
    refresh: vi.fn(),
    shareFolder: vi.fn(),
    shareProject: vi.fn(),
    join: vi.fn(),
    syncNow: vi.fn(),
  },
}));

vi.mock('@/components/Sharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Sharing')>()),
  useSharing: () => sharing.value,
}));

const folder = (id: string, name: string, position: number, parentId: string | null = null): Folder =>
  ({ id, name, position, parentId, expanded: false });

const folders: Folder[] = [
  folder('b', 'Beats', 2),
  folder('a', 'Album', 1),
  folder('a-sub', 'Album demos', 0, 'a'),
  folder('s1', 'Band EP', 4),
  folder('s2', 'Remix pack', 3),
  folder('s3', 'Live set', 5),
];

function Location() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderSidebar(currentFolderId: string | null = null, list: Folder[] = folders) {
  const onNavigate = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<><LibrarySidebar folders={list} currentFolderId={currentFolderId} onNavigate={onNavigate} /><Location /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onNavigate };
}

// The folder itself, not the Sync now button beside a shared folder (whose label also has the name).
const item = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  sharing.value.folders = {
    s1: sharedFolder({ folderId: 's1', name: 'Band EP', role: 'owner' }),
    s2: sharedFolder({ folderId: 's2', name: 'Remix pack', role: 'listen', members: [owner] }),
    s3: sharedFolder({ folderId: 's3', name: 'Live set', role: 'edit', members: [owner, bob], lastError: 'Disk full' }),
  };
  sharing.value.status = {};
  sharing.value.join.mockReset();
});

describe('LibrarySidebar', () => {
  it('is a labelled navigation', () => {
    renderSidebar();
    expect(screen.getByRole('navigation', { name: 'Library sections' })).toBeInTheDocument();
  });

  it('lists top-level own folders by position, without subfolders or shared ones', () => {
    renderSidebar();
    const heading = screen.getByText('My folders');
    const section = heading.parentElement!;
    const names = within(section).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names).toEqual(['Album', 'Beats']);
  });

  it('hides "My folders" when every folder is shared', () => {
    renderSidebar(null, folders.filter((f) => f.id.startsWith('s')));
    expect(screen.queryByText('My folders')).not.toBeInTheDocument();
  });

  it('lists shared folders by position', () => {
    renderSidebar();
    const section = screen.getByText('Shared').parentElement!;
    const names = within(section).getAllByRole('button').filter((b) => !b.classList.contains('lib-sidebar-sync')).map((b) => b.querySelector('span')?.textContent);
    expect(names).toEqual(['Remix pack', 'Band EP', 'Live set', 'Join shared folder…']);
  });

  it('explains how to share when nothing is shared', () => {
    sharing.value.folders = {};
    renderSidebar();
    expect(screen.getByText('Right-click a folder and choose Share to work on it with others.')).toBeInTheDocument();
  });

  it('marks All projects active at the top level', () => {
    renderSidebar(null);
    expect(item('All projects')).toHaveClass('is-active');
    expect(item('All projects')).toHaveAttribute('aria-current', 'page');
    expect(item('Album')).not.toHaveClass('is-active');
  });

  it('marks the current folder active', () => {
    renderSidebar('b');
    expect(item('Beats')).toHaveClass('is-active');
    expect(item('All projects')).not.toHaveClass('is-active');
    expect(item('All projects')).not.toHaveAttribute('aria-current');
  });

  it('keeps the top-level folder active inside a subfolder', () => {
    renderSidebar('a-sub');
    expect(screen.getByRole('button', { name: /^Album$/ })).toHaveClass('is-active');
    expect(item('Beats')).not.toHaveClass('is-active');
  });

  it('marks a shared folder active', () => {
    renderSidebar('s1');
    expect(item('Band EP')).toHaveClass('is-active');
  });

  it('navigates to All projects and to folders', () => {
    const { onNavigate } = renderSidebar('a');
    fireEvent.click(item('All projects'));
    fireEvent.click(item('Beats'));
    fireEvent.click(item('Remix pack'));
    expect(onNavigate.mock.calls).toEqual([[null], ['b'], ['s2']]);
  });

  it('says how you take part in each shared folder', () => {
    renderSidebar();
    expect(item('Band EP')).toHaveAttribute('title', 'Band EP · you share it');
    expect(item('Remix pack')).toHaveAttribute('title', 'Remix pack · listener');
    expect(item('Live set')).toHaveAttribute('title', 'Live set · collaborator');
  });

  it('uses a headphones icon for listening and a people icon otherwise', () => {
    renderSidebar();
    expect(item('Remix pack').querySelector('svg')).toHaveClass('lucide-headphones');
    expect(item('Band EP').querySelector('svg')).toHaveClass('lucide-users');
  });

  it('shows the number of people when synced and more than one', () => {
    renderSidebar();
    expect(within(item('Band EP')).getByLabelText('3 people')).toHaveTextContent('3');
    expect(within(item('Remix pack')).queryByLabelText(/people/)).not.toBeInTheDocument();
  });

  it('shows a problem from the last sync', () => {
    renderSidebar();
    expect(within(item('Live set')).getByLabelText('Sync problem')).toBeInTheDocument();
    expect(within(item('Live set')).queryByLabelText('2 people')).not.toBeInTheDocument();
  });

  it('shows a lock, not a sync problem, when access to a shared folder was closed', () => {
    sharing.value.folders = { ...sharing.value.folders, s3: { ...sharing.value.folders.s3, accessClosed: true } };
    renderSidebar();
    const row = item('Live set');
    expect(within(row).getByLabelText('Access closed')).toBeInTheDocument();
    expect(within(row).queryByLabelText('Sync problem')).not.toBeInTheDocument();
    expect(row).toHaveAttribute('title', 'Live set · access closed, your copies are still here');
  });

  it('live status wins over the cached state', () => {
    sharing.value.status = {
      s1: { folderId: 's1', state: 'syncing' },
      s3: { folderId: 's3', state: 'synced' },
    };
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Syncing Band EP' })).toBeDisabled();
    expect(within(item('Live set')).queryByLabelText('Sync problem')).not.toBeInTheDocument();
    expect(within(item('Live set')).getByLabelText('2 people')).toBeInTheDocument();
  });

  it('Join shared folder… opens the join dialog with nothing filled in', () => {
    renderSidebar();
    fireEvent.click(item('Join shared folder…'));
    expect(sharing.value.join).toHaveBeenCalledTimes(1);
    expect(sharing.value.join).toHaveBeenCalledWith();
  });

  it('Settings goes to the settings page', () => {
    renderSidebar();
    fireEvent.click(item('Settings'));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('offers Sync now next to each shared folder, disabled while it syncs', () => {
    sharing.value.status = { s1: { folderId: 's1', state: 'syncing' } } as any;
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Sync Live set now' }));
    expect(sharing.value.syncNow).toHaveBeenCalledWith('s3');
    expect(screen.getByRole('button', { name: 'Syncing Band EP' })).toBeDisabled();
  });
});
