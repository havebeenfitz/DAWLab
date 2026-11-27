import { describe, expect, it } from 'vitest';
import { defaultComparison } from '../CompareView';
import { toCompareVersions } from '@/pages/History/hooks/useCompareSession';
import { createCommitMenuItems } from '@/components/ContextMenu';

const v = (id: string) => ({ commitId: id, previewFile: `${id}.wav`, label: id });

describe('Compare versions', () => {
  it('lines a version up against the one before it, else the one after', () => {
    const all = [v('a'), v('b'), v('c')];
    expect(defaultComparison(v('b'), all)?.commitId).toBe('a');
    expect(defaultComparison(v('a'), all)?.commitId).toBe('b');
    expect(defaultComparison(v('a'), [v('a')])).toBeNull();
    expect(defaultComparison(v('x'), all)?.commitId).toBe('a');
  });

  it('offers only versions with a preview, numbered like the player', () => {
    const versions = toCompareVersions([
      { commit_id: 'a', message: 'first', preview_file: 'h1' },
      { commit_id: 'b', message: 'no audio' },
      { commit_id: 'c', message: '', preview_file: 'h3' },
    ] as never);
    expect(versions).toEqual([
      { commitId: 'a', previewFile: 'h1', label: 'Version 1 · first' },
      { commitId: 'c', previewFile: 'h3', label: 'Version 3' },
    ]);
  });

  it('puts Compare versions first in a version menu when it is available', () => {
    const noop = () => {};
    expect(createCommitMenuItems(noop, noop, noop, noop, noop).map((i) => i.label)[0]).toBe('Compare versions');
    expect(createCommitMenuItems(noop).map((i) => i.label)).toEqual(['Preview this version']);
  });
});
