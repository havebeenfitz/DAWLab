import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogicMergePlan } from '../LogicMergePlan';
import { ProjectChanges } from '@/components/FileExplorer/ProjectChanges';
import { unsavedSummary } from '@/pages/History/hooks/useWorkingChanges';

const plan = (over = {}) => [{
  alternative: '', readable: true, yours: [],
  todo: [
    { key: 'marker:Chorus', kind: 'marker', text: 'Move marker “Chorus” to bar 18', conflict: 'You changed this too: move marker “Chorus” to bar 16' },
    { key: 'strip:Keys', kind: 'strip', text: 'Bring over the track “Keys”' },
  ],
  done: [{ key: 'tempo:song', kind: 'tempo', text: 'Set the tempo to 121 BPM' }],
  ...over,
}];

let invoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  invoke = vi.fn(async () => plan());
  (window as any).ipcRenderer.invoke = invoke;
});

const props = { projectName: 'snow', author: 'elena', parentId: 'p', mineId: 'm', theirsId: 't' };

describe('LogicMergePlan', () => {
  it('lists what to bring over, flags clashes, and keeps what’s done apart', async () => {
    render(<LogicMergePlan {...props} />);
    expect(await screen.findByText('Bring over the track “Keys”')).toBeInTheDocument();
    expect(screen.getByText(/You changed this too/)).toBeInTheDocument();
    expect(screen.getByText('Already in your folder (1)')).toBeInTheDocument();
    expect(screen.getByText(/File › Import › Logic Projects/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('logic-merge-plan', 'snow', 'p', 'm', 't');
  });

  it('checks the folder again and says when everything is in', async () => {
    render(<LogicMergePlan {...props} />);
    await screen.findByText('Bring over the track “Keys”');
    invoke.mockResolvedValueOnce(plan({ todo: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Check my folder again/ }));
    expect(await screen.findByText(/Your folder has all of elena’s changes/)).toBeInTheDocument();
    expect(screen.queryByText(/File › Import/)).toBeNull();
  });

  it('shows nothing when the project data isn’t on this Mac', async () => {
    invoke.mockResolvedValue(null);
    const { container } = render(<LogicMergePlan {...props} />);
    await vi.waitFor(() => expect(screen.queryByText(/Working out/)).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProjectChanges', () => {
  it('marks additions and losses, and opens grouped lines', () => {
    render(<ProjectChanges lines={[
      { kind: 'marker-added', text: 'Marker “Intro” added at bar 1' },
      { kind: 'plugin-removed', text: '“Bass”: plugin Tape removed', loss: true },
      { kind: 'region-added', text: '6 regions added', items: ['Region “a” added at bar 1'] },
      { kind: 'tempo', text: 'Tempo 120 → 121 BPM' },
    ]} hideSongTempo />);
    expect(screen.getByText('Marker “Intro” added at bar 1').closest('li')).toHaveClass('change-added');
    expect(screen.getByText('“Bass”: plugin Tape removed').closest('li')).toHaveClass('change-removed');
    expect(screen.getByText('6 regions added').tagName).toBe('SUMMARY');
    expect(screen.queryByText('Tempo 120 → 121 BPM')).toBeNull();
  });
});

describe('unsavedSummary', () => {
  const pd = { kind: 'modified', path: 'snow.logicx/Alternatives/000/ProjectData' } as any;
  it('speaks only when the Logic project itself changed', () => {
    expect(unsavedSummary({ changes: [{ kind: 'modified', path: 'Audio Files/a.wav' } as any], logic: [] })).toBeUndefined();
    expect(unsavedSummary({ changes: [pd], logic: [{ kind: 'marker-added', text: 'Marker “A” added at bar 2' }] })).toEqual(['Marker “A” added at bar 2']);
    expect(unsavedSummary({ changes: [pd], logic: [] })).toEqual(['Logic project changed (no details for this kind of edit yet)']);
  });
});
