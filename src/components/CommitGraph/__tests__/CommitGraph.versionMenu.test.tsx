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

/** The rail row of a version (the selected version's title also shows in the bar below). */
const row = (message: string) => screen.getAllByRole('listitem').find((li) => li.classList.contains('rail-row') && within(li).queryByText(message)) as HTMLElement;
const bar = () => screen.getByLabelText('Selected version');
const select = (message: string) => fireEvent.click(row(message));
const moreButton = () => within(bar()).getByRole('button', { name: 'More actions for this version' });
const menu = () => document.querySelector('.context-menu') as HTMLElement | null;
const menuLabels = () => Array.from(menu()?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim());

let quiet: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
  vi.mocked(window.ipcRenderer.invoke).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { quiet.forEach((s) => s.mockRestore()); });

describe('CommitGraph version rail', () => {
  it('shows one row per version, newest first, and marks the current one', () => {
    renderGraph();
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('rail-row'));
    expect(rows.map((r) => r.querySelector('.rail-msg')!.textContent)).toEqual(['Mixdown', 'Added drums', 'First idea']);
    expect(row('Added drums')).toHaveAttribute('aria-current', 'true');
    expect(within(row('Added drums')).getByText('current')).toBeInTheDocument();
    expect(within(row('Mixdown')).queryByText('current')).not.toBeInTheDocument();
  });

  it('clicking a row selects it and shows it in the bar below, and so does Enter', () => {
    const onCommitSelect = vi.fn();
    renderGraph({ onCommitSelect });
    select('First idea');
    expect(onCommitSelect).toHaveBeenCalledWith('c1');
    fireEvent.keyDown(row('Mixdown'), { key: 'Enter' });
    expect(onCommitSelect).toHaveBeenCalledWith('c3');
  });

  it('the selected version has a labelled ⋯ button that opens every action', () => {
    renderGraph({ onDeleteCommit: vi.fn(), onEditTags: vi.fn(), selectedCommitId: 'c2' });
    expect(moreButton()).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(moreButton());
    expect(menuLabels()).toEqual(['Preview this version', 'New alternative from here', 'Edit tags', 'Delete this version']);
  });

  it('leaves out actions the parent does not support', () => {
    renderGraph({ selectedCommitId: 'c3' });
    fireEvent.click(moreButton());
    expect(menuLabels()).toEqual(['Preview this version', 'New alternative from here']);
  });

  it('right-click on a row opens the same menu for that version', () => {
    const onDeleteCommit = vi.fn();
    renderGraph({ onDeleteCommit });
    fireEvent.contextMenu(row('First idea'));
    fireEvent.click(within(menu()!).getByText('Delete this version'));
    expect(onDeleteCommit).toHaveBeenCalledWith('c1');
    expect(menu()).toBeNull();
  });

  it('Preview this version asks the main process to preview it', async () => {
    renderGraph({ selectedCommitId: 'c2' });
    fireEvent.click(moreButton());
    fireEvent.click(within(menu()!).getByText('Preview this version'));
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('preview-project', 'Song', 'c2', 'main'));
  });

  it('New alternative from here opens the naming dialog', () => {
    renderGraph({ selectedCommitId: 'c2' });
    fireEvent.click(moreButton());
    fireEvent.click(within(menu()!).getByText('New alternative from here'));
    expect(screen.getByRole('button', { name: 'Create alternative' })).toBeInTheDocument();
  });

  it('shows other people\'s names but not yours', () => {
    renderGraph({ me: 'Ann' });
    expect(within(row('Added drums')).getByText(/^Bob · /)).toBeInTheDocument();
    expect(within(row('Mixdown')).queryByText(/Ann/)).not.toBeInTheDocument();
  });

  describe('restore button wording (in the bar, for the selected version)', () => {
    it('says "On this Mac" for the version on this Mac and disables it', () => {
      renderGraph({ selectedCommitId: 'c2' });
      expect(within(bar()).getByRole('button', { name: /On this Mac/ })).toBeDisabled();
    });

    it('still says "On this Mac" with unsaved changes, but it can be clicked to go back', () => {
      const { props } = renderGraph({ hasUnsavedChanges: true, selectedCommitId: 'c2' });
      const btn = within(bar()).getByRole('button', { name: /On this Mac/ });
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      expect(props.onCheckout).toHaveBeenCalledWith('c2');
    });

    it('says "Restore" for older versions and restores on click', () => {
      const { props } = renderGraph({ selectedCommitId: 'c1' });
      fireEvent.click(within(bar()).getByRole('button', { name: /^Restore/ }));
      expect(props.onCheckout).toHaveBeenCalledWith('c1');
    });

    it('says "Get this version" for versions newer than the last restore', () => {
      renderGraph({ lastCheckoutTimestamp: '20260102120000', selectedCommitId: 'c3' });
      expect(within(bar()).getByRole('button', { name: /Get this version/ })).toBeEnabled();
    });

    it('says "Restoring" and disables while restoring', () => {
      renderGraph({ restoringCommitId: 'c1', selectedCommitId: 'c1' });
      expect(within(bar()).getByRole('button', { name: /Restoring/ })).toBeDisabled();
    });
  });

  describe('readOnly (listeners)', () => {
    it('hides Restore and On this Mac, keeps the menu with only Preview', () => {
      renderGraph({ readOnly: true, onDeleteCommit: vi.fn(), onEditTags: vi.fn(), selectedCommitId: 'c2' });
      expect(screen.queryByRole('button', { name: /Restore|On this Mac|Get this version/ })).not.toBeInTheDocument();
      fireEvent.click(moreButton());
      expect(menuLabels()).toEqual(['Preview this version']);
    });
  });

  it('marks unsaved work DAWLab kept and offers to bring it back', () => {
    renderGraph({
      commits: [...commits, { commit_id: 'c4', timestamp: '20260104120000', message: 'Unsaved work before switching to “First idea”', author: 'Ann', auto: true }],
      currentCommitId: 'c1',
      selectedCommitId: 'c4',
    });
    const kept = row('Unsaved work before switching to “First idea”');
    expect(kept).toHaveClass('is-auto');
    expect(within(kept).getByLabelText('Kept automatically')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: /Bring back/ })).toBeEnabled();
  });

  it('reads "Created branch X from commit Y" as the start of an alternative', () => {
    renderGraph({ commits: [{ commit_id: 'b1', timestamp: '20260105120000', message: 'Created branch drums from commit c2', author: 'Ann' }] });
    expect(within(row('Started the alternative “drums”')).getByText('Started the alternative “drums”')).toBeInTheDocument();
  });

  describe('parallel versions folded into the rail', () => {
    const forks = [{ branch: 'bob · 25 Nov', author: 'bob', parent: 'c2', commits: [
      { commit_id: 'b1', timestamp: '20260102130000', message: 'bob drums', author: 'bob' },
      { commit_id: 'b2', timestamp: '20260102140000', message: 'bob drums 2', author: 'bob' },
    ] }];

    it('shows one folded row where it split, with Preview and Dismiss', () => {
      const onPreviewFork = vi.fn();
      const onDismissFork = vi.fn();
      renderGraph({ forks, onPreviewFork, onDismissFork });
      const items = screen.getAllByRole('listitem').map((li) => li.classList.contains('rail-fold-item') ? 'fold' : li.querySelector('.rail-msg')?.textContent);
      expect(items).toEqual(['Mixdown', 'fold', 'Added drums', 'First idea']);
      expect(screen.getByRole('button', { name: /bob · 2 versions/ })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('bob drums')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
      fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
      expect(onPreviewFork).toHaveBeenCalledWith('bob · 25 Nov');
      expect(onDismissFork).toHaveBeenCalledWith('bob · 25 Nov');
    });

    it('opens to show its versions on a second lane, which can be selected', () => {
      const onCommitSelect = vi.fn();
      renderGraph({ forks, onCommitSelect });
      fireEvent.click(screen.getByRole('button', { name: /bob · 2 versions/ }));
      const lane = screen.getByRole('list', { name: 'Versions in bob · 25 Nov' });
      expect(within(lane).getAllByRole('listitem').map((li) => li.querySelector('.rail-msg')!.textContent)).toEqual(['bob drums 2', 'bob drums']);
      fireEvent.click(within(lane).getByText('bob drums'));
      expect(onCommitSelect).toHaveBeenCalledWith('b1');
    });
  });

  describe('the unsaved-changes tile', () => {
    it('is not there when nothing changed', () => {
      renderGraph({ onSaveCommit: vi.fn(), hasUnsavedChanges: false, unsavedCount: 0, onDiscard: vi.fn() });
      expect(screen.queryByLabelText('Version message')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    });

    it('says how many files changed and offers Save and Discard together', () => {
      const onSaveCommit = vi.fn();
      const onDiscard = vi.fn();
      renderGraph({ onSaveCommit, hasUnsavedChanges: true, unsavedCount: 3, onDiscard });
      expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes · 3 files');
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onDiscard).toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('Version message'), { target: { value: 'new chorus' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
      expect(onSaveCommit).toHaveBeenCalledWith('new chorus');
    });

    it('when saving anyway with no changes, says so and offers Cancel, not Discard', () => {
      renderGraph({ onSaveCommit: vi.fn(), hasUnsavedChanges: false, isCreatingCommit: true, onDiscard: vi.fn() });
      expect(screen.getByRole('status')).toHaveTextContent('No changes since the last save');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    });
  });
});

