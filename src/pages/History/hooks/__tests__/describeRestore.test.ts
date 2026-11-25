import { describe, expect, it } from 'vitest';
import { describeRestore } from '../useCommitActions';

const kept = { message: 'Unsaved work before switching to “conflict”' };

describe('what a Restore says it did', () => {
  it('says extra files went to the Trash and are kept in the automatic version', () => {
    expect(describeRestore({ keptAs: kept, removed: 3, trashedAs: 'lodge — removed by restore' })).toEqual({
      title: 'Restored, and your work is kept',
      detail: '3 extra files were moved to the Trash and kept in “Unsaved work before switching to “conflict””. Bring back restores them.',
    });
    expect(describeRestore({ keptAs: kept, removed: 1 })!.detail).toMatch(/^1 extra file was moved/);
  });

  it('says where unsaved work went when nothing was removed', () => {
    expect(describeRestore({ keptAs: kept, removed: 0 })!.detail).toBe('Your unsaved work is in “Unsaved work before switching to “conflict””. Bring back restores it.');
  });

  it('names the Trash folder when files were removed from a clean folder', () => {
    expect(describeRestore({ keptAs: null, removed: 2, trashedAs: 'lodge — removed by restore 2026' })!.detail)
      .toBe('2 extra files not in this version were moved to the Trash, in “lodge — removed by restore 2026”.');
  });

  it('says nothing when the Restore was plain', () => {
    expect(describeRestore({ keptAs: null, removed: 0 })).toBeNull();
    expect(describeRestore(undefined)).toBeNull();
  });
});
