import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LinkedAccounts from './LinkedAccounts';

const { unlinkMock, refreshMock } = vi.hoisted(() => ({ unlinkMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('@/lib/auth/client', () => ({ default: { unlinkAccount: unlinkMock } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('./PasskeyManager', () => ({ default: () => null }));

const accounts = [
  { providerId: 'credential', accountId: 'email-1' },
  { providerId: 'google', accountId: 'google-1' },
  { providerId: 'github', accountId: 'github-1' },
];

beforeEach(() => {
  vi.clearAllMocks();
  unlinkMock.mockResolvedValue({ data: { status: true }, error: null });
});

describe('Linked accounts', () => {
  it('keeps email mandatory while allowing removal of every external account', async () => {
    render(<LinkedAccounts accounts={accounts} hasPassword />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    for (const [providerId, name] of [['google', 'Google'], ['github', 'GitHub']]) {
      fireEvent.click(await screen.findByRole('button', { name: `Manage ${name} account` }));
      const dialog = screen.getByRole('dialog', { name: 'Linked Account Details' });
      expect(within(dialog).getByText(`${providerId}-1`)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: `Manage ${name} account` })).not.toBeInTheDocument();
      expect(unlinkMock).toHaveBeenLastCalledWith({ providerId, accountId: `${providerId}-1` });
    }
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Email & Password')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /link/i })).toHaveLength(2);
  });

  it('removes only the selected account when a provider is linked twice', async () => {
    render(<LinkedAccounts accounts={[accounts[0], accounts[2], { providerId: 'github', accountId: 'github-2' }]} hasPassword />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage GitHub account' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Manage GitHub account' })).toHaveLength(1);
    expect(unlinkMock).toHaveBeenCalledWith({ providerId: 'github', accountId: 'github-1' });
  });

  it.each(['api', 'network'])('retains the account after an %s error', async kind => {
    if (kind === 'api') unlinkMock.mockResolvedValue({ error: { message: 'Please sign in again' } });
    else unlinkMock.mockRejectedValue(new Error('Network unavailable'));
    render(<LinkedAccounts accounts={accounts} hasPassword />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Google account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'api' ? 'Please sign in again' : 'Network unavailable');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('offers password setup before an OAuth-only user can unlink accounts', async () => {
    render(<LinkedAccounts accounts={accounts.slice(1)} hasPassword={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Google account' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));
    expect(screen.getByRole('dialog', { name: 'Reset Password' })).toBeInTheDocument();
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});


describe('Linked account details', () => {
  it('shows mandatory email details without a remove action', () => {
    render(<LinkedAccounts accounts={accounts} hasPassword />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Email & Password account' }));
    const dialog = screen.getByRole('dialog', { name: 'Linked Account Details' });
    expect(within(dialog).getByText('Email & Password')).toBeInTheDocument();
    expect(within(dialog).getByText('email-1')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Email sign-in is required and cannot be removed.');
    expect(within(dialog).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('closes account details without removing anything', async () => {
    render(<LinkedAccounts accounts={accounts} hasPassword />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Google account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Manage Google account' })).toBeInTheDocument();
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
