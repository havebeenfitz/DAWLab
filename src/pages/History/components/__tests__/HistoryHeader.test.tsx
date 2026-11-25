import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryHeader } from '../HistoryHeader';
import type { ProjectAccess } from '@/hooks/useProjectAccess';
import { sharedFolder } from '@/components/Sharing/__tests__/fixtures';

const notShared: ProjectAccess = { folder: null, role: null, isListener: false };
const collaborator: ProjectAccess = { folder: sharedFolder({ role: 'edit' }), role: 'edit', isListener: false };
const listener: ProjectAccess = { folder: sharedFolder({ role: 'listen' }), role: 'listen', isListener: true };

function renderHeader(overrides: Partial<Parameters<typeof HistoryHeader>[0]> = {}) {
  const props = {
    projectName: 'Song',
    alternative: 'louder chorus',
    daw: 'Logic Pro X',
    isSyncing: false,
    showSettings: false,
    access: notShared,
    alternativesMenu: null,
    onBack: vi.fn(),
    onToggleAlternatives: vi.fn(),
    onSave: vi.fn(),
    onOpenInDaw: vi.fn(),
    onShare: vi.fn(),
    onToggleSettings: vi.fn(),
    ...overrides,
  };
  render(<HistoryHeader {...props} />);
  return props;
}

describe('HistoryHeader', () => {
  it('shows the project and alternative', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Song/louder chorus');
  });

  it('falls back to "Project" and "main"', () => {
    renderHeader({ projectName: '', alternative: '' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Project/main');
  });

  it('labels its icon buttons', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Back to Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project settings' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Alternatives/ })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('settings button reads "Back to versions" while settings are open', () => {
    renderHeader({ showSettings: true });
    expect(screen.getByRole('button', { name: 'Back to versions' })).toHaveAttribute('aria-pressed', 'true');
    // Settings view hides the version actions and alternatives.
    expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alternatives/ })).not.toBeInTheDocument();
  });

  it('says "Save version" and "Open in" with the DAW logo', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open in Logic Pro' });
    expect(open).toHaveAttribute('title', 'Open in Logic Pro');
    expect(screen.getByRole('img', { name: 'Logic Pro' })).toBeInTheDocument();
  });

  it('names an unknown DAW in text', () => {
    renderHeader({ daw: 'Bitwig' });
    expect(screen.getByRole('button', { name: 'Open in Bitwig' })).toBeInTheDocument();
  });

  it('says "your DAW" when the DAW is not known', () => {
    renderHeader({ daw: undefined });
    expect(screen.getByRole('button', { name: 'Open in your DAW' })).toBeInTheDocument();
  });

  it('fires each callback', () => {
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));
    fireEvent.click(screen.getByRole('button', { name: /Alternatives/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Logic Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project settings' }));
    expect(p.onBack).toHaveBeenCalledTimes(1);
    expect(p.onToggleAlternatives).toHaveBeenCalledTimes(1);
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onOpenInDaw).toHaveBeenCalledTimes(1);
    expect(p.onShare).toHaveBeenCalledTimes(1);
    expect(p.onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it('renders the alternatives menu next to its button', () => {
    renderHeader({ alternativesMenu: <div role="menu">alts</div> });
    expect(screen.getByRole('menu')).toHaveTextContent('alts');
  });

  it('disables Share without a project name', () => {
    renderHeader({ projectName: '' });
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('shows a syncing spinner', () => {
    renderHeader({ isSyncing: true });
    expect(screen.getByRole('status', { name: 'Syncing' })).toBeInTheDocument();
  });

  it('has no shared line when not shared', () => {
    renderHeader();
    expect(screen.queryByText(/Shared in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Listening in/)).not.toBeInTheDocument();
  });

  it('shows where a shared project lives and when it synced, and says Sharing', () => {
    renderHeader({ access: collaborator });
    expect(screen.getByText(/Shared in “Album”/)).toHaveTextContent('Shared in “Album” · synced 5 min ago');
    expect(screen.getByRole('button', { name: 'Sharing' })).toBeInTheDocument();
  });

  it('shows the live sync state in the shared line', () => {
    renderHeader({ access: collaborator, syncStatus: { folderId: 'f1', state: 'syncing' } });
    expect(screen.getByText(/Shared in/)).toHaveTextContent('· syncing…');
  });

  it('uses the live sync time when there is one', () => {
    renderHeader({ access: collaborator, syncStatus: { folderId: 'f1', state: 'synced', lastSync: new Date().toISOString() } });
    expect(screen.getByText(/Shared in/)).toHaveTextContent('synced just now');
  });

  describe('listener', () => {
    it('says "Listening in"', () => {
      renderHeader({ access: listener });
      expect(screen.getByText(/Listening in “Album”/)).toBeInTheDocument();
    });

    it('hides Save, Open, Alternatives and Settings but keeps Share', () => {
      renderHeader({ access: listener });
      expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Open in/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Alternatives/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Project settings' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sharing' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Back to Library' })).toBeInTheDocument();
    });

    it('a legacy listener (no folder) also loses the edit actions', () => {
      renderHeader({ access: { folder: null, role: 'listen', isListener: true } });
      expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      expect(screen.queryByText(/Listening in/)).not.toBeInTheDocument();
    });
  });

  describe('Pull for shared projects', () => {
    it('shows Pull with a badge of new versions from others, and pulls', () => {
      const pull = vi.fn();
      renderHeader({ access: collaborator, sync: { incoming: 3, pulling: false, pull } });
      const button = screen.getByRole('button', { name: /Pull/ });
      expect(screen.getByLabelText('3 new from others')).toHaveTextContent('3 new');
      fireEvent.click(button);
      expect(pull).toHaveBeenCalled();
    });

    it('is disabled while pulling and has no badge then', () => {
      renderHeader({ access: collaborator, sync: { incoming: 3, pulling: true, pull: vi.fn() } });
      expect(screen.getByRole('button', { name: /Pulling/ })).toBeDisabled();
      expect(screen.queryByLabelText('3 new from others')).not.toBeInTheDocument();
    });

    it('is not shown for projects that are not shared', () => {
      renderHeader({ sync: { incoming: 1, pulling: false, pull: vi.fn() } });
      expect(screen.queryByRole('button', { name: /Pull/ })).not.toBeInTheDocument();
    });
  });

  describe('Discard changes', () => {
    it('is shown only when files differ from the last save, and opens the dialog', () => {
      const open = vi.fn();
      renderHeader({ discard: { count: 3, open } });
      const button = screen.getByRole('button', { name: 'Discard changes' });
      expect(button).toHaveAttribute('title', '3 files changed since the last save. Go back to it');
      fireEvent.click(button);
      expect(open).toHaveBeenCalled();
    });

    it('is hidden with nothing to discard', () => {
      renderHeader({ discard: { count: 0, open: vi.fn() } });
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });

    it('is hidden in settings', () => {
      renderHeader({ showSettings: true, discard: { count: 2, open: vi.fn() } });
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });

    it('is hidden for listeners', () => {
      renderHeader({ access: listener, discard: { count: 2, open: vi.fn() } });
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });
  });
});

