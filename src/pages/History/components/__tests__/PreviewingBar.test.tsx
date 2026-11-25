import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewingBar } from '../PreviewingBar';
import { BranchGraph } from '../BranchGraph';

const preview = { branch: 'bob · 25 Nov', author: 'bob', message: 'new drums', path: '/Music/Song (preview · bob)' };

describe('PreviewingBar', () => {
  it('is hidden when nothing is previewed', () => {
    const { container } = render(<PreviewingBar preview={null} dawName="Logic Pro" busy={false} onOpen={vi.fn()} onBack={vi.fn()} onMakeMain={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says whose version you are looking at, where it is, and offers the ways on', () => {
    const p = { onOpen: vi.fn(), onBack: vi.fn(), onMakeMain: vi.fn() };
    render(<PreviewingBar preview={preview} dawName="Logic Pro" busy={false} {...p} />);
    const bar = screen.getByRole('status', { name: 'Previewing bob · 25 Nov' });
    expect(bar).toHaveTextContent('In its own folder · yours is untouched');
    expect(screen.getByTitle('“new drums” is in its own folder, “Song (preview · bob)”. Your project folder is untouched.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More for this preview' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Logic Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to main' }));
    expect(p.onOpen).toHaveBeenCalled(); expect(p.onMakeMain).toHaveBeenCalled(); expect(p.onBack).toHaveBeenCalled();
  });
});

describe('BranchGraph', () => {
  const branches = [
    { name: 'main', commits: [{ commit_id: 'a', timestamp: '1' }, { commit_id: 'b', timestamp: '3', parent: 'a' }] },
    { name: 'bob · 25 Nov', forkOf: { branch: 'main', parent: 'a', author: 'bob' }, commits: [{ commit_id: 'x', timestamp: '2', parent: 'a' }] },
  ];

  it('is not shown for a single line', () => {
    const { container } = render(<BranchGraph branches={[branches[0]]} selectedBranch="main" currentCommitId="b" onSelectBranch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every line, marks parallel ones, and switches on click', () => {
    const onSelectBranch = vi.fn();
    render(<BranchGraph branches={branches} selectedBranch="main" currentCommitId="b" onSelectBranch={onSelectBranch} />);
    expect(screen.getByRole('img', { name: '3 versions on 2 lines' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bob · 25 Nov/ })).toHaveTextContent('parallel');
    fireEvent.click(screen.getByRole('button', { name: /bob · 25 Nov/ }));
    expect(onSelectBranch).toHaveBeenCalledWith('bob · 25 Nov');
    fireEvent.click(screen.getByRole('button', { name: /Alternatives map/ }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
