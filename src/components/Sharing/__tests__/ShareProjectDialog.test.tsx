import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareProjectDialog } from '../ShareProjectDialog';
import type { ProjectRemote } from '../hub';
import { captureIpcEvents, emitIpc, invokeCalls, mockInvoke, remoteError, type InvokeHandler } from './ipcTestUtils';
import { sharedFolder } from './fixtures';

captureIpcEvents();

const legacyRemote: ProjectRemote = {
  hubUrl: 'https://hub.test',
  role: 'edit',
  editUrl: 'https://hub.test/s/EDITtokenEDITtokenEDIT',
  listenUrl: 'https://hub.test/s/LISTENtokenLISTENtoken',
  lastSync: new Date(Date.now() - 2 * 60_000).toISOString(),
};

async function renderDialog(projectName: string | null, routes: Record<string, InvokeHandler> = {}) {
  const onClose = vi.fn();
  const onShareFolder = vi.fn();
  mockInvoke({
    'hub-get-project-space': () => null,
    'hub-get-remote': () => null,
    'hub-project-share-context': () => ({ projectId: 'p1', folderId: 'f2', folderName: 'Beats' }),
    ...routes,
  });
  const utils = render(<ShareProjectDialog projectName={projectName} onClose={onClose} onShareFolder={onShareFolder} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onClose, onShareFolder, ...utils };
}

let clipboard: { writeText: ReturnType<typeof vi.fn> };
beforeEach(() => {
  clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
});

describe('ShareProjectDialog', () => {
  it('renders nothing and asks nothing when closed', async () => {
    await renderDialog(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokeCalls('hub-get-project-space')).toHaveLength(0);
  });

  it('hands a project in a shared folder straight to the folder dialog', async () => {
    const { onShareFolder } = await renderDialog('Song', { 'hub-get-project-space': () => sharedFolder() });
    expect(onShareFolder).toHaveBeenCalledWith('f1', 'Album');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokeCalls('hub-get-remote')).toHaveLength(0);
    expect(invokeCalls('hub-project-share-context')).toHaveLength(0);
  });

  describe('project in a plain folder', () => {
    it('offers to share the folder', async () => {
      const { onShareFolder } = await renderDialog('Song');
      expect(screen.getByRole('dialog', { name: 'Share “Song”' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Share the folder “Beats”' }));
      expect(onShareFolder).toHaveBeenCalledWith('f2', 'Beats');
      expect(screen.getByText(/moves it into a new folder named “Song” inside “Beats”/)).toBeInTheDocument();
    });

    it('"Share only this project" makes a folder for it and shares that', async () => {
      const changed = vi.fn();
      window.addEventListener('dawlab:library-changed', changed);
      const { onShareFolder } = await renderDialog('Song', {
        'hub-make-folder-for-project': () => ({ folderId: 'f-new', folderName: 'Song' }),
      });
      fireEvent.click(screen.getByRole('button', { name: /Share only this project/ }));
      await waitFor(() => expect(onShareFolder).toHaveBeenCalledWith('f-new', 'Song'));
      expect(invokeCalls('hub-make-folder-for-project')).toEqual([['Song']]);
      expect(changed).toHaveBeenCalledTimes(1);
      window.removeEventListener('dawlab:library-changed', changed);
    });

    it('shows the error when the folder cannot be made', async () => {
      const { onShareFolder } = await renderDialog('Song', {
        'hub-make-folder-for-project': () => { throw remoteError('hub-make-folder-for-project', 'Project not found'); },
      });
      fireEvent.click(screen.getByRole('button', { name: /Share only this project/ }));
      expect(await screen.findByText('Project not found')).toBeInTheDocument();
      expect(onShareFolder).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Share only this project/ })).toBeEnabled();
    });

    it('Cancel closes', async () => {
      const { onClose } = await renderDialog('Song');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('project in no folder', () => {
    it('only offers a folder of its own', async () => {
      await renderDialog('Loose', { 'hub-project-share-context': () => ({ projectId: 'p', folderId: null, folderName: null }) });
      expect(screen.queryByRole('button', { name: /Share the folder/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Share only this project/ })).toHaveClass('ui-btn-primary');
      expect(screen.getByText('This puts the project in a new folder named “Loose” and shares that folder.')).toBeInTheDocument();
    });
  });

  it('stays closed if the main process has no context for the project', async () => {
    await renderDialog('Ghost', { 'hub-project-share-context': () => null });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('treats lookup failures as not shared', async () => {
    await renderDialog('Song', {
      'hub-get-project-space': () => { throw new Error('offline'); },
      'hub-get-remote': () => { throw new Error('offline'); },
    });
    expect(screen.getByRole('dialog', { name: 'Share “Song”' })).toBeInTheDocument();
  });

  describe('project shared on its own (legacy)', () => {
    it('shows its links and when it last synced', async () => {
      await renderDialog('Song', { 'hub-get-remote': () => legacyRemote });
      expect(screen.getByRole('dialog', { name: '“Song” is shared on its own' })).toBeInTheDocument();
      expect(screen.getByDisplayValue(legacyRemote.editUrl)).toBeInTheDocument();
      expect(screen.getByDisplayValue(legacyRemote.listenUrl!)).toBeInTheDocument();
      expect(screen.getByText(/Last synced 2 min ago/)).toBeInTheDocument();
    });

    it('hides the listener link when there is none', async () => {
      await renderDialog('Song', { 'hub-get-remote': () => ({ ...legacyRemote, listenUrl: undefined }) });
      expect(screen.getByRole('button', { name: 'Copy Collaborator link' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copy Listener link' })).not.toBeInTheDocument();
    });

    it('copies a link', async () => {
      await renderDialog('Song', { 'hub-get-remote': () => legacyRemote });
      fireEvent.click(screen.getByRole('button', { name: 'Copy Listener link' }));
      await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(legacyRemote.listenUrl));
    });

    it('Sync now syncs the project and says what moved', async () => {
      await renderDialog('Song', {
        'hub-get-remote': () => legacyRemote,
        'hub-sync-project': () => ({ pushed: 2, pulled: 1, uploadedFiles: 0, downloadedFiles: 0, remote: { ...legacyRemote, lastSync: new Date().toISOString() } }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
      expect(await screen.findByText('Synced: sent 2, received 1 version(s).')).toBeInTheDocument();
      expect(invokeCalls('hub-sync-project')).toEqual([['Song']]);
      expect(screen.getByText(/Last synced just now/)).toBeInTheDocument();
    });

    it('shows sync errors', async () => {
      await renderDialog('Song', {
        'hub-get-remote': () => legacyRemote,
        'hub-sync-project': () => { throw remoteError('hub-sync-project', 'Link revoked'); },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
      expect(await screen.findByText('Link revoked')).toBeInTheDocument();
    });

    it('shows progress for this project', async () => {
      await renderDialog('Song', { 'hub-get-remote': () => legacyRemote });
      act(() => { emitIpc('hub-sync-progress', { key: 'Song', message: 'Uploading audio' }); });
      expect(screen.getByText('Uploading audio')).toBeInTheDocument();
    });

    it('Disconnect unlinks the project and closes', async () => {
      const { onClose } = await renderDialog('Song', {
        'hub-get-remote': () => legacyRemote,
        'hub-unlink-project': () => ({ success: true }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(invokeCalls('hub-unlink-project')).toEqual([['Song']]);
    });

    it('Done closes', async () => {
      const { onClose } = await renderDialog('Song', { 'hub-get-remote': () => legacyRemote });
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
