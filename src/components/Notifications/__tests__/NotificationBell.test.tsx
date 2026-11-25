import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell, ago } from '../NotificationBell';
import { NotificationSettings } from '@/pages/Settings/NotificationSettings';

const notice = (id: string, extra = {}) => ({
  id, folderId: 'f1', folderName: 'Chigura', projectName: 'test', commitId: id, author: 'elenadanilova',
  message: 'аудио', parallel: false, at: new Date(Date.now() - 5 * 60_000).toISOString(), read: false, ...extra,
});
const feed = (over = {}) => ({
  notices: [notice('p1:2'), notice('p1:1', { read: true, parallel: true, message: 'alt' })],
  unread: 1, enabled: true, sound: 'rooster', soundFileName: null, muted: [] as string[], folders: [{ folderId: 'f1', name: 'Chigura' }], ...over,
});

let invoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  invoke = vi.fn(async (channel: string) => (channel === 'notifications-open' ? true : feed()));
  (window as any).ipcRenderer.invoke = invoke;
});

describe('NotificationBell', () => {
  it('shows the unread count and lists who saved what, where', async () => {
    render(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: '1 new version from collaborators' });
    expect(bell).toHaveTextContent('1');
    fireEvent.click(bell);
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('elenadanilova saved a version“аудио”test · Chigura · 5 min ago');
    expect(screen.getAllByRole('menuitem')[1]).toHaveTextContent('saved a parallel version');
  });

  it('opens a version and marks everything read', async () => {
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /new version/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(invoke).toHaveBeenCalledWith('notifications-mark-read');
    fireEvent.click(screen.getAllByRole('menuitem')[0]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('notifications-open', 'p1:2'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('explains itself when there is nothing yet', async () => {
    invoke.mockResolvedValue(feed({ notices: [], unread: 0, folders: [] }));
    render(<NotificationBell />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'New versions from collaborators' }));
    expect(screen.getByText('Share a folder to hear when collaborators save versions.')).toBeInTheDocument();
  });
});

describe('NotificationSettings', () => {
  it('switches notifications off and mutes one folder', async () => {
    render(<NotificationSettings />);
    const folder = await screen.findByRole('checkbox', { name: 'Chigura' });
    fireEvent.click(folder);
    expect(invoke).toHaveBeenCalledWith('notifications-set-muted', 'f1', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tell me when collaborators save versions' }));
    expect(invoke).toHaveBeenCalledWith('notifications-set-enabled', false);
  });
});

describe('the sound setting', () => {
  it('picks a sound, previews it, and asks for a file for a custom one', async () => {
    render(<NotificationSettings />);
    const select = await screen.findByRole('combobox', { name: 'Sound' });
    expect(select).toHaveValue('rooster');
    fireEvent.change(select, { target: { value: 'none' } });
    expect(invoke).toHaveBeenCalledWith('notifications-set-sound', 'none');
    fireEvent.change(select, { target: { value: 'custom' } });
    expect(invoke).toHaveBeenCalledWith('notifications-choose-sound');
    expect(invoke).not.toHaveBeenCalledWith('notifications-set-sound', 'custom');
    fireEvent.click(screen.getByRole('button', { name: 'Preview the sound' }));
    expect(invoke).toHaveBeenCalledWith('notifications-preview-sound');
  });

  it('names the chosen custom file', async () => {
    invoke.mockResolvedValue(feed({ sound: 'custom', soundFileName: 'Ding.aiff' }));
    render(<NotificationSettings />);
    expect(await screen.findByRole('option', { name: 'Custom: Ding.aiff' })).toBeInTheDocument();
  });
});

describe('ago', () => {
  it('says how long ago, briefly', () => {
    const now = Date.parse('2026-11-25T20:00:00Z');
    expect(ago('2026-11-25T19:59:40Z', now)).toBe('just now');
    expect(ago('2026-11-25T17:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-11-24T12:00:00Z', now)).toBe('yesterday');
  });
});
