import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServerSettings } from '../ServerSettings';
import { invokeCalls, mockInvoke, remoteError, type InvokeHandler } from '@/components/Sharing/__tests__/ipcTestUtils';

async function renderSettings(routes: Record<string, InvokeHandler> = {}) {
  mockInvoke({
    'hub-get-settings': () => ({ hubUrl: 'https://old.example', hasKey: false }),
    'hub-test-connection': () => ({ ok: true, message: 'Connected to DAWLab server 1.2' }),
    'hub-save-settings': (s: { hubUrl: string; hubKey?: string }) => ({ hubUrl: s.hubUrl, hasKey: true }),
    ...routes,
  });
  const utils = render(<ServerSettings />);
  await act(async () => {});
  return utils;
}

const address = () => screen.getByLabelText('Address');
const password = () => screen.getByLabelText(/^Password/);
const save = () => screen.getByRole('button', { name: 'Check and save' });

describe('ServerSettings', () => {
  it('loads the saved address', async () => {
    await renderSettings();
    expect(address()).toHaveValue('https://old.example');
    expect(password()).toHaveValue('');
    expect(screen.queryByText('saved')).not.toBeInTheDocument();
  });

  it('shows a "saved" badge and keep-password hint when a password is stored', async () => {
    await renderSettings({ 'hub-get-settings': () => ({ hubUrl: 'https://h', hasKey: true }) });
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(password()).toHaveAttribute('placeholder', 'Leave empty to keep the saved password');
  });

  it('keeps empty fields when settings cannot be loaded', async () => {
    await renderSettings({ 'hub-get-settings': () => { throw new Error('x'); } });
    expect(address()).toHaveValue('');
    expect(save()).toBeDisabled();
  });

  it('disables Check and save without an address', async () => {
    await renderSettings();
    fireEvent.change(address(), { target: { value: '   ' } });
    expect(save()).toBeDisabled();
  });

  it('checks, then saves the address and password, and clears the field', async () => {
    await renderSettings();
    fireEvent.change(address(), { target: { value: 'https://new.example' } });
    fireEvent.change(password(), { target: { value: 's3cret' } });
    fireEvent.click(save());

    expect(await screen.findByRole('status')).toHaveTextContent('Connected to DAWLab server 1.2');
    expect(invokeCalls('hub-test-connection')).toEqual([[{ hubUrl: 'https://new.example', hubKey: 's3cret' }]]);
    expect(invokeCalls('hub-save-settings')).toEqual([[{ hubUrl: 'https://new.example', hubKey: 's3cret' }]]);
    await waitFor(() => expect(password()).toHaveValue(''));
    expect(screen.getByText('saved')).toBeInTheDocument();
  });

  it('keeps the saved password when the field is empty (sends no hubKey)', async () => {
    await renderSettings({ 'hub-get-settings': () => ({ hubUrl: 'https://h', hasKey: true }) });
    fireEvent.click(save());
    await screen.findByRole('status');
    const [[candidate]] = invokeCalls('hub-test-connection') as [[Record<string, unknown>]];
    expect(candidate).toEqual({ hubUrl: 'https://h' });
    expect('hubKey' in candidate).toBe(false);
    expect(invokeCalls('hub-save-settings')).toEqual([[{ hubUrl: 'https://h' }]]);
  });

  it('does not save when the check fails and shows why', async () => {
    await renderSettings({ 'hub-test-connection': () => ({ ok: false, message: 'Wrong password' }) });
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');
    expect(invokeCalls('hub-save-settings')).toHaveLength(0);
  });

  it('shows thrown errors without the Electron prefix', async () => {
    await renderSettings({ 'hub-test-connection': () => { throw remoteError('hub-test-connection', 'getaddrinfo ENOTFOUND'); } });
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(/^getaddrinfo ENOTFOUND$/);
    expect(invokeCalls('hub-save-settings')).toHaveLength(0);
    expect(save()).toBeEnabled();
  });

  it('shows "Checking…" and disables the fields while checking', async () => {
    let finish: (v: unknown) => void = () => {};
    await renderSettings({ 'hub-test-connection': () => new Promise((r) => { finish = r; }) });
    fireEvent.click(save());
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(address()).toBeDisabled();
    expect(password()).toBeDisabled();
    await act(async () => { finish({ ok: false, message: 'nope' }); });
    expect(save()).toBeEnabled();
  });

  it('clears the result when the address or password is edited', async () => {
    await renderSettings({ 'hub-test-connection': () => ({ ok: false, message: 'Wrong password' }) });
    fireEvent.click(save());
    await screen.findByRole('alert');
    fireEvent.change(password(), { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(save());
    await screen.findByRole('alert');
    fireEvent.change(address(), { target: { value: 'https://other' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has the #server anchor for links from the sharing dialog', async () => {
    const { container } = await renderSettings();
    expect(container.querySelector('#server')).not.toBeNull();
  });
});
