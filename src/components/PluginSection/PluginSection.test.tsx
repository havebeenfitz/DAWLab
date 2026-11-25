import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginSection } from './PluginSection';
import { diffPlugins } from '../../../shared/version-diff';

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset();
  (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke };
});

const p = (name: string, count = 1, is_instrument = false) => ({ name, manufacturer: 'Vendor', type: 'VST3', is_instrument, count });

describe('PluginSection with changes', () => {
  it('marks added, removed and count changes', async () => {
    invoke.mockResolvedValue([{ name: 'Pro-Q 3', type: 'VST3', path: '/x' }, { name: 'Serum', type: 'VST3', path: '/y' }]);
    const changes = diffPlugins([p('Pro-Q 3', 1), p('Old Comp')], [p('Pro-Q 3', 3), p('Serum', 1, true)]);
    const plugins = changes.changes.filter(c => c.kind !== 'removed').map(c => c.plugin);
    const { container } = render(<PluginSection plugins={plugins} changes={changes} />);
    await waitFor(() => expect(screen.queryByText('Scanning plugins...')).toBeNull());
    expect(container.querySelector('.plugin-changes-summary')?.textContent).toBe('+1 added−1 removed~1 used more or less');
    expect(container.querySelector('.plugin-row-added')?.textContent).toContain('Serum');
    expect(screen.getByText(/×1 → ×3/)).toBeTruthy();
    expect(screen.getByText('Removed in this version')).toBeTruthy();
    expect(container.querySelector('.plugin-row-removed')?.textContent).toContain('Old Comp');
  });

  it('says when nothing changed, and does not flag plugins missing without a scan', async () => {
    invoke.mockResolvedValue([]);
    const changes = diffPlugins([p('Pro-Q 3')], [p('Pro-Q 3')]);
    const { container } = render(<PluginSection plugins={[p('Pro-Q 3')]} changes={changes} />);
    await waitFor(() => expect(screen.getByText('No plugin changes since the previous version')).toBeTruthy());
    expect(container.querySelector('.plugin-row-missing')).toBeNull();
  });

  it('flags a plugin missing when the scan found others but not it', async () => {
    invoke.mockResolvedValue([{ name: 'FabFilter Pro-Q 3', type: 'AU', path: '/x' }]);
    const { container } = render(<PluginSection plugins={[p('pro-q 3'), p('Serum')]} />);
    await waitFor(() => expect(container.querySelector('.plugin-row-missing')).not.toBeNull());
    expect(container.querySelector('.plugin-row-missing')?.textContent).toContain('Serum');
    expect(container.querySelectorAll('.plugin-row-missing')).toHaveLength(1);
  });

  it('shows the tracks a plugin is on in one line, the full list in the tooltip', async () => {
    render(<PluginSection plugins={[{ name: 'Pro-C 2', manufacturer: 'FabFilter', tracks: ['Bass', 'Vocals', 'Drum bus'] }]} changes={null} />);
    const tracks = await screen.findByText('Bass, Vocals, Drum bus');
    expect(tracks).toHaveClass('plugin-tracks');
    expect(tracks).toHaveAttribute('title', 'On Bass, Vocals, Drum bus');
  });
});
