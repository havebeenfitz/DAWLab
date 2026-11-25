import { describe, expect, it, vi } from 'vitest';
import { buildFolderMenuItems, buildProjectMenuItems } from '../../contextMenuItems';

const base = { close: vi.fn(), open: vi.fn(), share: vi.fn(), manageTags: vi.fn() };

describe('Remove from DAWLab menu items', () => {
  it('folder menu offers it only when allowed, as a danger item', () => {
    const remove = vi.fn();
    const close = vi.fn();
    const items = buildFolderMenuItems({ isShared: false, close, share: vi.fn(), rename: vi.fn(), remove: vi.fn(), removeFromLibrary: remove });
    const item = items.find(i => i.label === 'Remove from DAWLab…')!;
    expect(item.danger).toBe(true);
    item.onClick();
    expect(close).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    const shared = buildFolderMenuItems({ isShared: true, close, share: vi.fn(), rename: vi.fn(), remove: vi.fn() });
    expect(shared.some(i => i.label.startsWith('Remove from'))).toBe(false);
  });

  it('project menu counts the selection', () => {
    const remove = vi.fn();
    expect(buildProjectMenuItems({ ...base }).some(i => i.label.includes('DAWLab'))).toBe(false);
    const one = buildProjectMenuItems({ ...base, removeCount: 1, removeFromLibrary: remove });
    expect(one.at(-1)!.label).toBe('Remove from DAWLab…');
    const many = buildProjectMenuItems({ ...base, removeCount: 91, removeFromLibrary: remove });
    expect(many.at(-1)!.label).toBe('Remove 91 Projects from DAWLab…');
    many.at(-1)!.onClick();
    expect(remove).toHaveBeenCalled();
  });
});
