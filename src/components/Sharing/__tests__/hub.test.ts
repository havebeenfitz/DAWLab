import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureIpcEvents, emitIpc, ipcRegistrations, invokeCalls, mockInvoke } from './ipcTestUtils';
import { errorText, hub, onHubProgress, onJoinLink, onSyncStatus, relativeTime, roleHint, roleLabel } from '../hub';

captureIpcEvents();

describe('hub events', () => {
  it('registers one ipc listener per channel however many subscribers there are', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onSyncStatus(a);
    const offB = onSyncStatus(b);
    expect(ipcRegistrations('hub-status')).toBe(1);

    emitIpc('hub-status', { folderId: 'f1', state: 'synced' });
    expect(a).toHaveBeenCalledWith({ folderId: 'f1', state: 'synced' });
    expect(b).toHaveBeenCalledWith({ folderId: 'f1', state: 'synced' });
    offA(); offB();
  });

  it('stops calling a subscriber after it unsubscribes, keeps the others', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onJoinLink(a);
    const offB = onJoinLink(b);
    offA();
    emitIpc('join-shared', 'dawlab://join/abc');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('dawlab://join/abc');
    offB();
    emitIpc('join-shared', 'dawlab://join/def');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not register again when subscribing after everyone left', () => {
    const off = onJoinLink(vi.fn());
    off();
    const again = vi.fn();
    const off2 = onJoinLink(again);
    expect(ipcRegistrations('join-shared')).toBe(1);
    emitIpc('join-shared', 'x');
    expect(again).toHaveBeenCalledWith('x');
    off2();
  });

  it('onHubProgress only passes messages for its key', () => {
    const projectCb = vi.fn();
    const joinCb = vi.fn();
    const offP = onHubProgress('My Song', projectCb);
    const offJ = onHubProgress('join', joinCb);
    expect(ipcRegistrations('hub-sync-progress')).toBe(1);

    emitIpc('hub-sync-progress', { key: 'My Song', message: 'Uploading 2 of 5' });
    const transfer = { phase: 'download', fileIndex: 1, fileCount: 2, bytesDone: 5, bytesTotal: 10 };
    emitIpc('hub-sync-progress', { key: 'join', message: 'Downloading', transfer });
    emitIpc('hub-sync-progress', { key: 'other', message: 'ignored' });
    emitIpc('hub-sync-progress', null);

    expect(projectCb).toHaveBeenCalledTimes(1);
    expect(projectCb).toHaveBeenCalledWith('Uploading 2 of 5', undefined);
    expect(joinCb).toHaveBeenCalledTimes(1);
    expect(joinCb).toHaveBeenCalledWith('Downloading', transfer);
    offP(); offJ();
  });

  it('a subscriber that unsubscribes twice does not break the channel', () => {
    const cb = vi.fn();
    const off = onSyncStatus(cb);
    off(); off();
    const other = vi.fn();
    const offOther = onSyncStatus(other);
    emitIpc('hub-status', { folderId: 'x', state: 'syncing' });
    expect(other).toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    offOther();
  });
});

describe('hub calls', () => {
  beforeEach(() => { mockInvoke({}); });

  it('passes channel and arguments through to ipcRenderer.invoke', async () => {
    await hub.createInvite('f1', 'listen');
    await hub.join('CODE', '/Users/me/Music');
    await hub.changeRole('f1', 'm2', 'edit');
    await hub.revokeInvite('f1', 'inv1');
    await hub.saveSettings({ hubUrl: 'https://h', hubKey: 'k' });
    expect(invokeCalls('hub-create-invite')).toEqual([['f1', 'listen', undefined, undefined]]);
    expect(invokeCalls('hub-join-space')).toEqual([['CODE', '/Users/me/Music']]);
    expect(invokeCalls('hub-change-role')).toEqual([['f1', 'm2', 'edit']]);
    expect(invokeCalls('hub-revoke-invite')).toEqual([['f1', 'inv1']]);
    expect(invokeCalls('hub-save-settings')).toEqual([[{ hubUrl: 'https://h', hubKey: 'k' }]]);
  });

  it('returns what the main process returns', async () => {
    mockInvoke({ 'hub-list-spaces': () => [{ folderId: 'a' }] });
    await expect(hub.listFolders()).resolves.toEqual([{ folderId: 'a' }]);
  });
});

describe('relativeTime', () => {
  const NOW = new Date('2026-06-15T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const MIN = 60_000;
  const H = 60 * MIN;
  const D = 24 * H;

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('says never without a date', () => {
    expect(relativeTime()).toBe('never');
    expect(relativeTime('')).toBe('never');
  });

  it.each([
    [0, 'just now'],
    [29_000, 'just now'],
    [31_000, '1 min ago'],
    [59 * MIN, '59 min ago'],
    [59.5 * MIN, '1 h ago'],
    [60 * MIN, '1 h ago'],
    [23 * H, '23 h ago'],
    [24 * H, 'yesterday'],
    [35 * H, 'yesterday'],
    [36 * H, '2 days ago'],
    [6 * D, '6 days ago'],
  ])('%d ms ago reads "%s"', (ms, expected) => {
    expect(relativeTime(ago(ms))).toBe(expected);
  });

  it('shows a date from a week on', () => {
    const iso = ago(7 * D);
    expect(relativeTime(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  it('treats future times as just now', () => {
    expect(relativeTime(new Date(NOW + 5 * MIN).toISOString())).toBe('just now');
  });
});

describe('errorText', () => {
  it('strips the Electron prefix', () => {
    expect(errorText(new Error("Error invoking remote method 'hub-share-folder': Error: Not allowed"))).toBe('Not allowed');
    expect(errorText(new Error("Error invoking remote method 'x': RangeError: big"))).toBe('RangeError: big');
  });

  it('keeps other messages and stringifies non-errors', () => {
    expect(errorText(new Error('Plain'))).toBe('Plain');
    expect(errorText('text')).toBe('text');
    expect(errorText(undefined)).toBe('undefined');
  });
});

describe('labels', () => {
  it('names every role', () => {
    expect(roleLabel).toEqual({ owner: 'Owner', edit: 'Collaborator', listen: 'Listener' });
    expect(Object.keys(roleHint)).toEqual(['edit', 'listen']);
  });
});

import { describeSync } from '../hub';
describe('describeSync', () => {
  it('says what a manual sync did, or that all is up to date', () => {
    expect(describeSync({ ok: true })).toBe('Up to date');
    expect(describeSync({ ok: true, pulledVersions: 1 })).toBe('1 new version pulled');
    expect(describeSync({ ok: true, pulledVersions: 3, pushedVersions: 2, addedProjects: ['A'], uploadedProjects: ['B', 'C'] }))
      .toBe('1 new project, 3 new versions pulled, 2 projects shared, 2 versions sent');
  });
});
