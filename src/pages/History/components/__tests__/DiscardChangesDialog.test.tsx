import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiscardChangesDialog } from '../DiscardChangesDialog';
import type { WorkingChange } from '../../hooks/useWorkingChanges';

const changes: WorkingChange[] = [
  { path: 'Audio Files/vox.wav', kind: 'added' },
  { path: 'Audio Files/snare.wav', kind: 'deleted' },
  { path: 'lodge.logicx/Alternatives/000/ProjectData', kind: 'modified' },
];

function renderDialog(overrides: Partial<Parameters<typeof DiscardChangesDialog>[0]> = {}) {
  const props = {
    open: true, projectName: 'lodge', alternative: 'main', changes, dawOpen: null,
    onDiscard: vi.fn(async () => {}), onClose: vi.fn(), ...overrides,
  };
  render(<DiscardChangesDialog {...props} />);
  return props;
}

describe('DiscardChangesDialog', () => {
  it('lists what will be undone like git: changed, new, deleted', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toHaveTextContent('lodge goes back to the last saved version of “main”.');
    const rows = within(screen.getByRole('list', { name: 'What will be undone' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Mlodge.logicx/Alternatives/000/ProjectData',
      '+Audio Files/vox.wav',
      '−Audio Files/snare.wav',
    ]);
    expect(screen.getByLabelText('Summary')).toHaveTextContent('1 changed file1 new file1 deleted file');
    expect(screen.getByLabelText('new since the last save, will be removed')).toHaveTextContent('+');
  });

  it('says the current files go to the Trash first', () => {
    renderDialog();
    expect(screen.getByText(/Your current 2 files \(changed and new\) go to the Trash first/)).toBeInTheDocument();
  });

  it('says nothing is overwritten when files were only deleted', () => {
    renderDialog({ changes: [{ path: 'a.wav', kind: 'deleted' }] });
    expect(screen.getByText(/Nothing is overwritten/)).toBeInTheDocument();
  });

  it('warns when the DAW is open', () => {
    renderDialog({ dawOpen: 'Logic Pro' });
    expect(screen.getByRole('alert')).toHaveTextContent('Logic Pro is open. Close lodge there first');
  });

  it('Cancel is focused first, and closes', () => {
    const p = renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onDiscard).not.toHaveBeenCalled();
  });

  it('Discard runs it and shows a failure in the dialog', async () => {
    const onDiscard = vi.fn(async () => { throw new Error("Error invoking remote method 'discard-working-changes': Error: Couldn't move your current files to the Trash, so nothing was changed."); });
    renderDialog({ onDiscard });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText("Couldn't move your current files to the Trash, so nothing was changed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled());
  });

  it('caps a very long list', () => {
    renderDialog({ changes: Array.from({ length: 205 }, (_, i) => ({ path: `f${String(i).padStart(3, '0')}.wav`, kind: 'added' as const })) });
    expect(screen.getByText('…and 5 more')).toBeInTheDocument();
  });
});
