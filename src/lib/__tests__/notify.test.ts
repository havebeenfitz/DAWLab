import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNotice, errorMessage, notify, subscribeNotices, type Notice } from '../notify';

/** Current notices, via a throwaway subscription. */
function current(): Notice[] {
  let seen: Notice[] = [];
  const off = subscribeNotices((n) => { seen = n; });
  off();
  return seen;
}

function clearAll() {
  for (const n of current()) dismissNotice(n.id);
}

describe('notify', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('calls a new subscriber right away with the current notices', () => {
    notify.info('Hello');
    const listener = vi.fn();
    const off = subscribeNotices(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual([expect.objectContaining({ kind: 'info', title: 'Hello' })]);
    off();
  });

  it('publishes every change to subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeNotices(listener);
    listener.mockClear();
    const id = notify.success('Saved', 'All good');
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({ id, kind: 'success', title: 'Saved', detail: 'All good' })]);
    off();
    notify.info('Later');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns increasing ids', () => {
    const a = notify.info('a');
    const b = notify.info('b');
    expect(b).toBeGreaterThan(a);
  });

  it('keeps at most 4 notices, dropping the oldest', () => {
    for (const t of ['1', '2', '3', '4', '5', '6']) notify.info(t);
    expect(current().map((n) => n.title)).toEqual(['3', '4', '5', '6']);
  });

  it('dismisses one notice by id', () => {
    const a = notify.info('a');
    notify.info('b');
    dismissNotice(a);
    expect(current().map((n) => n.title)).toEqual(['b']);
  });

  it('auto-dismisses info and success after 4 s', () => {
    notify.info('info');
    notify.success('ok');
    vi.advanceTimersByTime(3999);
    expect(current()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(current()).toHaveLength(0);
  });

  it('auto-dismisses errors after 8 s', () => {
    notify.error('broken');
    expect(current()[0].timeout).toBe(8000);
    vi.advanceTimersByTime(7999);
    expect(current()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(current()).toHaveLength(0);
  });

  it('auto-dismiss of a notice that was dismissed already is harmless', () => {
    const a = notify.info('a');
    dismissNotice(a);
    notify.info('b');
    vi.advanceTimersByTime(4000);
    expect(current()).toHaveLength(0);
  });

  it('error keeps a string detail as is', () => {
    notify.error('Could not share', 'Server is offline');
    expect(current()[0]).toMatchObject({ kind: 'error', detail: 'Server is offline' });
  });

  it('error takes the detail from an Error, without the Electron prefix', () => {
    notify.error('Could not share', new Error("Error invoking remote method 'hub-share-folder': Error: No server"));
    expect(current()[0].detail).toBe('No server');
  });

  it('error without detail has no detail', () => {
    notify.error('Oops');
    expect(current()[0].detail).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it('strips the Electron remote-method prefix with an inner Error:', () => {
    expect(errorMessage(new Error("Error invoking remote method 'hub-join-space': Error: Invite expired"))).toBe('Invite expired');
  });

  it('strips the prefix without an inner Error:', () => {
    expect(errorMessage(new Error("Error invoking remote method 'x': TypeError: bad"))).toBe('TypeError: bad');
  });

  it('strips a leading "Error: "', () => {
    expect(errorMessage({ message: 'Error: plain' })).toBe('plain');
  });

  it('uses plain strings and other values', () => {
    expect(errorMessage('just text')).toBe('just text');
    expect(errorMessage(42)).toBe('42');
  });

  it('falls back for null and undefined', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong.');
    expect(errorMessage(null)).toBe('Something went wrong.');
  });
});
