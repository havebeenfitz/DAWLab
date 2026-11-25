import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../Toaster';
import { dismissNotice, notify, subscribeNotices, type Notice } from '@/lib/notify';

function clearAll() {
  let seen: Notice[] = [];
  subscribeNotices((n) => { seen = n; })();
  for (const n of seen) dismissNotice(n.id);
}

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders an empty notifications region', () => {
    render(<Toaster />);
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toBeEmptyDOMElement();
  });

  it('shows notices that already exist when it mounts', () => {
    notify.info('Earlier');
    render(<Toaster />);
    expect(screen.getByText('Earlier')).toBeInTheDocument();
  });

  it('shows title and detail of new notices', () => {
    render(<Toaster />);
    act(() => { notify.success('Saved', 'Version 3 is on the server'); });
    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('ui-toast-success');
    expect(within(toast).getByText('Saved')).toBeInTheDocument();
    expect(within(toast).getByText('Version 3 is on the server')).toBeInTheDocument();
  });

  it('uses role alert for errors and status for the rest', () => {
    render(<Toaster />);
    act(() => {
      notify.info('Info');
      notify.error('Broken', new Error("Error invoking remote method 'x': Error: Disk full"));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Broken');
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    expect(screen.getByRole('alert')).not.toHaveTextContent('invoking');
    expect(screen.getByRole('status')).toHaveTextContent('Info');
  });

  it('dismisses a notice with its button', () => {
    render(<Toaster />);
    act(() => { notify.info('One'); notify.info('Two'); });
    const buttons = screen.getAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(buttons[0]);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('removes notices when they time out', () => {
    render(<Toaster />);
    act(() => { notify.info('Short'); notify.error('Long'); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Short')).not.toBeInTheDocument();
    expect(screen.getByText('Long')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Long')).not.toBeInTheDocument();
  });

  it('shows at most 4 notices', () => {
    render(<Toaster />);
    act(() => { for (let i = 1; i <= 5; i++) notify.info(`N${i}`); });
    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(screen.queryByText('N1')).not.toBeInTheDocument();
  });

  it('stops listening after unmount', () => {
    const { unmount } = render(<Toaster />);
    unmount();
    expect(() => act(() => { notify.info('After'); })).not.toThrow();
  });
});
