// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, sendMailMock } = vi.hoisted(() => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://local.dev:3443');
  vi.stubEnv('BETTER_AUTH_SECRET', 'email-change-test-secret-0123456789abcdef');
  return {
    db: { user: [], account: [], session: [], verification: [] } as Record<string, Record<string, unknown>[]>,
    sendMailMock: vi.fn(),
  };
});

vi.mock('@/lib/prisma/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('better-auth/adapters/prisma', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  return { prismaAdapter: () => memoryAdapter(db) };
});
vi.mock('@/lib/mail', () => ({ sendMail: sendMailMock }));
vi.mock('@/lib/helpers/html', () => ({
  renderComponentToHTML: (_component: unknown, props: { verificationUrl: string }) => Promise.resolve(props.verificationUrl),
}));

import { auth } from './auth';
import { hashPassword } from '@/lib/bcrypt';

const BASE_URL = 'https://local.dev:3443';
let cookie: string;
let testIP = 0;

function requestEmailChange(newEmail: string, sessionCookie = cookie) {
  return auth.handler(new Request(`${BASE_URL}/api/auth/change-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE_URL, cookie: sessionCookie, 'x-forwarded-for': `192.0.2.${testIP}` },
    body: JSON.stringify({ newEmail, callbackURL: '/profile?tab=auth' }),
  }));
}

beforeEach(async () => {
  testIP++;
  vi.clearAllMocks();
  for (const rows of Object.values(db)) rows.length = 0;
  sendMailMock.mockResolvedValue({ success: true });
  const now = new Date();
  db.user.push({ id: 'user-1', name: 'Alice', email: 'alice@example.com', emailVerified: true, createdAt: now, updatedAt: now });
  db.account.push({
    id: 'account-1', accountId: 'user-1', userId: 'user-1', providerId: 'credential',
    password: await hashPassword('Test-password-123!'), createdAt: now, updatedAt: now,
  });
  const login = await auth.api.signInEmail({
    body: { email: 'alice@example.com', password: 'Test-password-123!' }, asResponse: true,
  });
  expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
});

describe('Verified email changes', () => {
  it('requires confirmation from both inboxes before updating the email', async () => {
    const response = await requestEmailChange('new@example.com');
    expect(response.status).toBe(200);
    expect(db.user[0].email).toBe('alice@example.com');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toBe('alice@example.com');

    const confirmationURL = sendMailMock.mock.calls[0][2];
    const confirmation = await auth.handler(new Request(confirmationURL));
    expect(confirmation.status).toBe(302);
    expect(db.user[0].email).toBe('alice@example.com');
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls[1][0]).toBe('new@example.com');

    const verificationURL = sendMailMock.mock.calls[1][2];
    expect(new URL(verificationURL).searchParams.get('callbackURL')).toBe('/profile?tab=auth');
    const verification = await auth.handler(new Request(verificationURL));
    expect(verification.status).toBe(302);
    expect(verification.headers.get('location')).toBe('/profile?tab=auth');
    expect(db.user[0].email).toBe('new@example.com');
    expect(db.user[0].emailVerified).toBe(true);
  });

  it('rejects unauthenticated requests and invalid email addresses', async () => {
    expect((await requestEmailChange('new@example.com', '')).status).toBe(401);
    expect((await requestEmailChange('invalid')).status).toBe(400);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(db.user[0].email).toBe('alice@example.com');
  });

  it('does not send confirmation for an address already in use', async () => {
    db.user.push({ ...db.user[0], id: 'user-2', email: 'taken@example.com' });
    expect((await requestEmailChange('taken@example.com')).status).toBe(200);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(db.user[0].email).toBe('alice@example.com');
  });

  it('leaves the address unchanged when confirmation delivery fails', async () => {
    sendMailMock.mockResolvedValue({ success: false });
    expect((await requestEmailChange('new@example.com')).status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(db.user[0].email).toBe('alice@example.com');
  });
});

function addOAuthAccount(providerId: string, accountId = `${providerId}-1`, userId = 'user-1') {
  db.account.push({ id: `${userId}-${accountId}`, providerId, accountId, userId, createdAt: new Date(), updatedAt: new Date() });
}

function unlink(providerId: string, accountId?: string, sessionCookie = cookie) {
  return auth.handler(new Request(`${BASE_URL}/api/auth/unlink-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE_URL, cookie: sessionCookie, 'x-forwarded-for': `192.0.2.${testIP}` },
    body: JSON.stringify({ providerId, accountId }),
  }));
}

describe('Unlinking accounts', () => {
  it('removes every external account while preserving email sign-in', async () => {
    addOAuthAccount('google');
    addOAuthAccount('github');
    expect((await unlink('google', 'google-1')).status).toBe(200);
    expect((await unlink('github', 'github-1')).status).toBe(200);
    expect(db.account).toHaveLength(1);
    expect(db.account[0].providerId).toBe('credential');
    expect(db.account[0].password).toBeTruthy();
    expect(db.user[0].email).toBe('alice@example.com');
  });

  it.each(['credential', 'credentials'])('rejects direct requests to unlink %s', async providerId => {
    addOAuthAccount('google');
    expect((await unlink(providerId)).status).toBe(400);
    expect(db.account).toHaveLength(2);
    expect(db.account[0].providerId).toBe('credential');
  });

  it('requires a usable email password before unlinking OAuth accounts', async () => {
    db.account[0].password = null;
    addOAuthAccount('google');
    const response = await unlink('google');
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('Set an email password before removing linked accounts.');
    expect(db.account).toHaveLength(2);
  });

  it('never removes another user’s linked account', async () => {
    addOAuthAccount('google', 'other-google', 'user-2');
    expect((await unlink('google', 'other-google')).status).toBe(400);
    expect(db.account).toHaveLength(2);
  });

  it('lets OAuth-only users establish email sign-in through password reset, then unlink OAuth', async () => {
    db.account.length = 0;
    addOAuthAccount('google');
    expect((await unlink('google')).status).toBe(400);
    await auth.api.requestPasswordReset({ body: { email: 'alice@example.com', redirectTo: '/reset-password' } });
    expect(sendMailMock).toHaveBeenCalledWith('alice@example.com', 'Reset Your Password', expect.any(String));
    const verification = db.verification.find(row => String(row.identifier).startsWith('reset-password:'));
    expect(verification).toBeDefined();
    const token = String(verification!.identifier).slice('reset-password:'.length);
    await auth.api.resetPassword({ body: { token, newPassword: 'New-test-password-123!' } });
    const login = await auth.api.signInEmail({
      body: { email: 'alice@example.com', password: 'New-test-password-123!' }, asResponse: true,
    });
    expect(login.status).toBe(200);
    cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    expect((await unlink('google')).status).toBe(200);
    expect(db.account).toHaveLength(1);
    expect(db.account[0].providerId).toBe('credential');
  });

  it('rejects unauthenticated and stale sessions', async () => {
    addOAuthAccount('google');
    expect((await unlink('google', undefined, '')).status).toBe(401);
    db.session[0].createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect((await unlink('google')).status).toBe(403);
    expect(db.account).toHaveLength(2);
  });
});
