import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VersionChangesList } from '../VersionChangesList';
import { diffFileMaps } from '../../../../shared/version-diff';

describe('VersionChangesList', () => {
  it('shows each change with its git-style mark and the totals', () => {
    const diff = diffFileMaps(
      [{ path: 'song.als', hash: '1' }, { path: 'old.wav', hash: 'o' }, { path: 'a/mix.wav', hash: 'm' }],
      [{ path: 'song.als', hash: '2' }, { path: 'new.wav', hash: 'n' }, { path: 'b/mix.wav', hash: 'm' }],
    );
    const { container } = render(<VersionChangesList diff={diff} hasParent parentMessage="rough mix" />);
    expect(screen.getByText(/Compared with/).textContent).toContain('“rough mix”');
    const rows = Array.from(container.querySelectorAll('.change-row')).map(r => r.textContent);
    expect(rows).toEqual(['Ra/mix.wav → b/mix.wav', '+new.wav', '−old.wav', 'Msong.als']);
    expect(container.querySelector('.chg-added')?.textContent).toBe('+1');
    expect(container.querySelector('.chg-removed')?.textContent).toBe('−1');
    expect(container.querySelector('.chg-modified')?.textContent).toBe('~1');
    expect(container.querySelector('.chg-renamed')?.textContent).toBe('→1');
  });

  it('explains a first version and an empty change set', () => {
    const { rerender } = render(<VersionChangesList diff={diffFileMaps(null, [{ path: 'a', hash: '1' }])} hasParent={false} parentMessage={null} />);
    expect(screen.getByText('First version: every file is new')).toBeTruthy();
    rerender(<VersionChangesList diff={diffFileMaps([{ path: 'a', hash: '1' }], [{ path: 'a', hash: '1' }])} hasParent parentMessage={null} />);
    expect(screen.getByText('No files changed in this version')).toBeTruthy();
    expect(screen.getByText(/the previous version/)).toBeTruthy();
  });
});
