import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForkNotice } from '../ForkNotice';

describe('ForkNotice', () => {
  it('is not shown on a normal alternative', () => {
    const { container } = render(<ForkNotice forkOf={null} branchName="main" fromCount={4} onGoTo={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says this is a parallel version, that nothing was lost, and goes back', () => {
    const onGoTo = vi.fn();
    render(<ForkNotice forkOf={{ branch: 'main', author: 'elena' }} branchName="elena · 25 Nov (2)" fromCount={7} onGoTo={onGoTo} />);
    const note = screen.getByRole('note', { name: 'Parallel alternative' });
    expect(note).toHaveTextContent('elena · 25 Nov (2) is a parallel version of main');
    expect(note).toHaveTextContent('The other 7 versions of the project are on main; nothing was lost.');
    fireEvent.click(screen.getByRole('button', { name: 'Go to main' }));
    expect(onGoTo).toHaveBeenCalledWith('main');
  });

  it('tells the collaborator who dismissed it and why, and that it stays', () => {
    render(<ForkNotice forkOf={{ branch: 'main', author: 'elena' }} branchName="elena · 25 Nov" fromCount={3} onGoTo={vi.fn()} dismissed={{ by: 'max', comment: 'Keeping mine' }} />);
    expect(screen.getByRole('note')).toHaveTextContent('max dismissed this parallel version: “Keeping mine”. It stays here, and you can keep working in it.');
  });
});

