import { describe, expect, it } from 'vitest';
import { railItems, railTime, railWho, railMessage } from '../rail';

const c = (id: string, ts: string, author = 'max') => ({ commit_id: id, timestamp: ts, message: id, author });

describe('version rail rows', () => {
  const main = [c('m1', '20261125100000'), c('m2', '20261125110000'), c('m3', '20261125120000')];

  it('lists versions newest first', () => {
    expect(railItems(main, []).map((i) => (i.kind === 'version' ? i.commit.commit_id : 'fold'))).toEqual(['m3', 'm2', 'm1']);
  });

  it('folds each parallel version into one row just above the version it split from', () => {
    const forks = [
      { branch: 'bob · 25 Nov', author: 'bob', parent: 'm2', commits: [c('b1', '20261125113000', 'bob'), c('b2', '20261125130000', 'bob')] },
      { branch: 'ann · 25 Nov', author: 'ann', parent: 'm1', commits: [c('a1', '20261125103000', 'ann')] },
    ];
    const items = railItems(main, forks);
    expect(items.map((i) => (i.kind === 'version' ? i.commit.commit_id : `fold:${i.fork.author}`))).toEqual(['m3', 'fold:bob', 'm2', 'fold:ann', 'm1']);
    const bob = items[1];
    expect(bob.kind === 'fold' && bob.versions.map((v) => v.commit_id)).toEqual(['b2', 'b1']);
  });

  it('puts a fork whose split point is elsewhere on top, and leaves out empty ones', () => {
    const items = railItems(main, [
      { branch: 'x', author: 'x', parent: 'gone', commits: [c('x1', '20261125090000', 'x')] },
      { branch: 'empty', author: 'e', parent: 'm1', commits: [] },
    ]);
    expect(items.map((i) => (i.kind === 'version' ? i.commit.commit_id : `fold:${i.fork.branch}`))).toEqual(['fold:x', 'm3', 'm2', 'm1']);
  });

  it('shows the time for today, the date for older days, and the year for other years', () => {
    const now = new Date(2026, 10, 25, 18, 0);
    expect(railTime('20261125142000', now)).toBe('14:20');
    expect(railTime('20261124142000', now)).toBe('24 Nov');
    expect(railTime('20251124142000', now)).toBe('24 Nov 2025');
    expect(railTime('bad', now)).toBe('');
  });

  it('names other people, not you', () => {
    const now = new Date(2026, 10, 25, 18, 0);
    expect(railWho(c('a', '20261125142000', 'elena'), 'max', now)).toBe('elena · 14:20');
    expect(railWho(c('a', '20261125142000', 'max'), 'max', now)).toBe('14:20');
  });

  it('reads branch-start messages as plain words', () => {
    expect(railMessage('Created branch louder chorus from commit 20261125-abc')).toBe('Started the alternative “louder chorus”');
    expect(railMessage('Created branch drums')).toBe('Started the alternative “drums”');
    expect(railMessage('new vox\nmore detail')).toBe('new vox');
    expect(railMessage('')).toBe('Version');
  });
});
