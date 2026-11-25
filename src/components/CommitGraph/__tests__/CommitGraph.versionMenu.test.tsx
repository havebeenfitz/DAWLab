import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitGraph, type CommitGraphProps } from '../CommitGraph';

const commits = [
  { commit_id: 'c1', timestamp: '20260101120000', message: 'First idea', author: 'Ann' },
  { commit_id: 'c2', timestamp: '20260102120000', message: 'Added drums', author: 'Bob' },
  { commit_id: 'c3', timestamp: '20260103120000', message: 'Mixdown', author: 'Ann' },
];

function renderGraph(props: Partial<CommitGraphProps> = {}) {
  const all: CommitGraphProps = {
    commits,
    onCheckout: vi.fn(),
    projectName: 'Song',
    currentBranch: 'main',
    currentCommitId: 'c2',
    ...props,
  };
  const utils = render(<CommitGraph {...all} />);
  return { props: all, ...utils };
}

const card = (message: string) => screen.getByText(message).closest('.commit-card') as HTMLElement;
const moreButton = (message: string) => within(card(message)).getByRole('button', { name: 'More actions for this version' });
const menu = () => document.querySelector('.context-menu') as HTMLElement | null;
const menuLabels = () => Array.from(menu()?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim());

let quiet: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
  vi.mocked(window.ipcRenderer.invoke).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { quiet.forEach((s) => s.mockRestore()); });

describe('CommitGraph version actions', () => {
  it('every version has a labelled ⋯ button that announces a menu', () => {
    renderGraph();
    const buttons = screen.getAllByRole('button', { name: 'More actions for this version' });
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      expect(b).toHaveAttribute('aria-haspopup', 'menu');
      expect(b).toHaveAttribute('title', 'More actions');
    }
  });

  it('⋯ opens the version menu with every action', () => {
    renderGraph({ onDeleteCommit: vi.fn(), onEditTags: vi.fn() });
    expect(menu()).toBeNull();
    fireEvent.click(moreButton('Added drums'));
    expect(menuLabels()).toEqual(['Preview this version', 'New alternative from here', 'Edit tags', 'Delete this version']);
  });

  it('⋯ does not select the version', () => {
    const onCommitSelect = vi.fn();
    renderGraph({ onCommitSelect });
    fireEvent.click(moreButton('First idea'));
    expect(onCommitSelect).not.toHaveBeenCalled();
  });

  it('leaves out actions the parent does not support', () => {
    renderGraph();
    fireEvent.click(moreButton('Mixdown'));
    expect(menuLabels()).toEqual(['Preview this version', 'New alternative from here']);
  });

  it('right-click opens the same menu', () => {
    renderGraph();
    fireEvent.contextMenu(card('Mixdown'));
    expect(menuLabels()).toContain('Preview this version');
  });

  it('runs the action for the version whose ⋯ was clicked', () => {
    const onDeleteCommit = vi.fn();
    const onEditTags = vi.fn();
    renderGraph({ onDeleteCommit, onEditTags });

    fireEvent.click(moreButton('First idea'));
    fireEvent.click(within(menu()!).getByText('Delete this version'));
    expect(onDeleteCommit).toHaveBeenCalledWith('c1');
    expect(menu()).toBeNull();

    fireEvent.click(moreButton('Mixdown'));
    fireEvent.click(within(menu()!).getByText('Edit tags'));
    expect(onEditTags).toHaveBeenCalledWith('c3', expect.any(Number), expect.any(Number));
  });

  it('Preview this version asks the main process to preview it', async () => {
    renderGraph();
    fireEvent.click(moreButton('Added drums'));
    fireEvent.click(within(menu()!).getByText('Preview this version'));
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('preview-project', 'Song', 'c2', 'main'));
    expect(menu()).toBeNull();
  });

  it('New alternative from here opens the naming dialog', () => {
    renderGraph();
    fireEvent.click(moreButton('Added drums'));
    fireEvent.click(within(menu()!).getByText('New alternative from here'));
    expect(screen.getByRole('button', { name: 'Create alternative' })).toBeInTheDocument();
    expect(screen.getByText('Name of the alternative')).toBeInTheDocument();
  });

  describe('restore button wording', () => {
    it('says "On this Mac" for the version on this Mac and disables it', () => {
      renderGraph();
      const btn = within(card('Added drums')).getByRole('button', { name: /On this Mac/ });
      expect(btn).toBeDisabled();
    });

    it('still says "On this Mac" with unsaved changes, but it can be clicked to go back', () => {
      const { props } = renderGraph({ hasUnsavedChanges: true });
      const btn = within(card('Added drums')).getByRole('button', { name: /On this Mac/ });
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      expect(props.onCheckout).toHaveBeenCalledWith('c2');
    });

    it('says "Restore" for older versions and restores on click', () => {
      const { props } = renderGraph();
      const btn = within(card('First idea')).getByRole('button', { name: /^Restore/ });
      fireEvent.click(btn);
      expect(props.onCheckout).toHaveBeenCalledWith('c1');
    });

    it('says "Get this version" for versions newer than the last restore', () => {
      renderGraph({ lastCheckoutTimestamp: '20260102120000' });
      expect(within(card('Mixdown')).getByRole('button', { name: /Get this version/ })).toBeEnabled();
      expect(within(card('First idea')).getByRole('button', { name: /^Restore/ })).toBeInTheDocument();
    });

    it('says "Restoring" and disables while restoring', () => {
      renderGraph({ restoringCommitId: 'c1' });
      expect(within(card('First idea')).getByRole('button', { name: /Restoring/ })).toBeDisabled();
    });
  });

  describe('readOnly (listeners)', () => {
    it('hides Restore and On this Mac buttons', () => {
      renderGraph({ readOnly: true });
      expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /On this Mac/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Get this version/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'More actions for this version' })).toHaveLength(3);
    });

    it('menu offers only "Preview this version"', () => {
      renderGraph({ readOnly: true, onDeleteCommit: vi.fn(), onEditTags: vi.fn() });
      fireEvent.click(moreButton('Added drums'));
      expect(menuLabels()).toEqual(['Preview this version']);
      fireEvent.contextMenu(card('Mixdown'));
      expect(menuLabels()).toEqual(['Preview this version']);
    });
  });

  it('marks unsaved work DAWLab kept and offers to bring it back', () => {
    renderGraph({
      commits: [...commits, { commit_id: 'c4', timestamp: '20260104120000', message: 'Unsaved work before switching to “First idea”', author: 'Ann', auto: true }],
      currentCommitId: 'c1',
    });
    const kept = card('Unsaved work before switching to “First idea”');
    expect(kept).toHaveClass('auto-snapshot');
    expect(within(kept).getByText('Kept automatically')).toBeInTheDocument();
    expect(within(kept).getByRole('button', { name: /Bring back/ })).toBeEnabled();
    expect(within(card('Mixdown')).getByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(within(card('Mixdown')).queryByText('Kept automatically')).not.toBeInTheDocument();
  });
});

