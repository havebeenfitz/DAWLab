import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SelectionBar } from '../SelectionBar';

const props = () => ({
  count: 3, actionable: 3, busy: false, allSelected: false,
  onSelectAll: vi.fn(), onArchive: vi.fn(), onRemove: vi.fn(), onClear: vi.fn(),
});

describe('SelectionBar', () => {
  it('is hidden with nothing selected', () => {
    const { container } = render(<SelectionBar {...props()} count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('runs bulk actions on the selection', () => {
    const p = props();
    render(<SelectionBar {...p} />);
    expect(screen.getByText('3 projects selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Archive'));
    fireEvent.click(screen.getByText('Remove…'));
    fireEvent.click(screen.getByText('Select all'));
    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(p.onArchive).toHaveBeenCalled();
    expect(p.onRemove).toHaveBeenCalled();
    expect(p.onSelectAll).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();
  });

  it('disables actions when every selected project is in a shared folder', () => {
    render(<SelectionBar {...props()} actionable={0} allSelected />);
    expect(screen.getByText('Archive').closest('button')).toBeDisabled();
    expect(screen.queryByText('Select all')).toBeNull();
  });
});
