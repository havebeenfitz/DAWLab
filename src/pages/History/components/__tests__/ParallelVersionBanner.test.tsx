import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const player = vi.hoisted(() => ({ toggleSource: vi.fn(), playingId: null as string | null }));
vi.mock('@/hooks/useLibraryPreview', () => ({ useLibraryPreview: () => player }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/notify', async (orig) => ({ ...(await orig<typeof import('@/lib/notify')>()), notify }));

import { ParallelVersionBanner } from '../ParallelVersionBanner';

const invoke = window.ipcRenderer.invoke as unknown as ReturnType<typeof vi.fn>;
const fork = (preview?: string) => ({
  branch: 'bob · 25 Nov', author: 'bob', from: 'main', parent: 'base',
  tip: { commit_id: 'B', message: 'new drums', author: 'bob', timestamp: '20261125120000', ...(preview ? { preview_file: preview } : {}) },
});
const renderBanner = (over: Partial<Parameters<typeof ParallelVersionBanner>[0]> = {}) => {
  const props = { projectName: 'Song', versions: [fork('p'.repeat(64))], currentTipId: 'A', username: 'max', onChanged: vi.fn(), ...over };
  render(<ParallelVersionBanner {...props} />);
  return props;
};

describe('ParallelVersionBanner', () => {
  beforeEach(() => { invoke.mockReset(); player.toggleSource.mockReset(); player.playingId = null; notify.success.mockReset(); notify.error.mockReset(); });

  it('renders nothing without parallel versions', () => {
    const { container } = render(<ParallelVersionBanner projectName="Song" versions={[]} currentTipId="A" username="max" onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says whose version it is and where it went', () => {
    renderBanner();
    const banner = screen.getByRole('region', { name: 'Parallel version from bob' });
    expect(banner).toHaveTextContent('“new drums” was saved on the same version as yours, so it went into the alternative “bob · 25 Nov”.');
  });

  it('plays their preview, and explains when there is none', async () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Listen/ }));
    const [id, resolve] = player.toggleSource.mock.calls[0];
    expect(id).toBe('parallel:B');
    invoke.mockResolvedValueOnce('http://x');
    await resolve();
    expect(invoke).toHaveBeenCalledWith('get-preview-url', 'Song', 'B', 'p'.repeat(64));
  });

  it('disables Listen without a preview', () => {
    renderBanner({ versions: [fork()] });
    expect(screen.getByRole('button', { name: /Listen/ })).toBeDisabled();
  });

  it('compares their version with your newest one', async () => {
    invoke.mockResolvedValueOnce({
      commitId: 'B', parentId: 'A', parentMessage: null,
      files: { changes: [{ kind: 'modified', path: 'Song.als' }], added: 0, removed: 0, modified: 1, renamed: 0, unchanged: 3 },
      plugins: { changes: [{ kind: 'added', plugin: { name: 'EZdrummer 3' }, before: 0, after: 1 }], added: 1, removed: 0, countChanged: 0 },
      song: { tempo: 90 }, songChanges: { changes: [{ field: 'tempo', label: 'Tempo', before: '86 BPM', after: '90 BPM' }], audioAdded: [], audioRemoved: [] },
    });
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    expect(invoke).toHaveBeenCalledWith('get-version-changes', 'Song', 'B', 'A');
    expect(await screen.findByText('Tempo: 86 BPM → 90 BPM')).toBeInTheDocument();
    expect(screen.getByText('EZdrummer 3')).toBeInTheDocument();
    expect(screen.getByText('Song.als')).toBeInTheDocument();
  });

  it('makes their version main after a confirmation, then reloads', async () => {
    invoke.mockResolvedValueOnce({ commitId: 'M', branch: 'main' });
    const props = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Make main/ }));
    expect(screen.getByText('Continue main with bob’s version? Yours stays in the history.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make main' }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('make-parallel-version-main', 'Song', 'bob · 25 Nov', 'max');
    expect(notify.success).toHaveBeenCalled();
  });

  it('can back out of making it main, and reports failures', async () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Make main/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Compare/ })).toBeInTheDocument();
    invoke.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: /Make main/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Make main' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Couldn’t make it main', 'disk full'));
  });

  describe('Dismiss…', () => {
    it('needs a reason, then dismisses with it and reloads', async () => {
      invoke.mockResolvedValue({ tip: 'B' });
      const props = renderBanner();
      fireEvent.click(screen.getByRole('button', { name: /Dismiss…/ }));
      const dialog = screen.getByRole('dialog', { name: 'Dismiss bob’s parallel version?' });
      expect(dialog).toHaveTextContent('The alternative stays for everyone');
      const go = screen.getByRole('button', { name: 'Dismiss' });
      expect(go).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: '  Keeping my chorus  ' } });
      expect(go).toBeEnabled();
      fireEvent.click(go);
      await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
      expect(invoke).toHaveBeenCalledWith('dismiss-parallel-version', 'Song', 'bob · 25 Nov', 'max', 'Keeping my chorus');
      expect(notify.success).toHaveBeenCalledWith('Parallel version dismissed', expect.stringMatching(/stays; bob sees your reason/));
    });

    it('shows a failure in the dialog', async () => {
      invoke.mockRejectedValue(new Error('Set your name in Settings first.'));
      renderBanner();
      fireEvent.click(screen.getByRole('button', { name: /Dismiss…/ }));
      fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Set your name in Settings first.');
    });
  });
});

