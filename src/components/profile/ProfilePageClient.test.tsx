import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProfilePageClient from "./ProfilePageClient";

const changeEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/client", () => ({ default: { changeEmail: changeEmailMock } }));

vi.mock("./ProfilePictureGallery", () => ({ default: () => null }));
vi.mock("./LinkedAccounts", () => ({ default: () => null }));
vi.mock("./MyRegistrations", () => ({ default: () => null }));
vi.mock("@/components/common/CountryAutocomplete", () => ({
  default: () => null,
}));

const BASE_USER = {
  id: "user-1",
  name: "Alice Example",
  username: "alice-example",
  email: "alice@example.com",
  country: "US",
  legalName: null,
  addressLine1: null,
  addressLine2: null,
  addressCity: null,
  addressState: null,
  addressPostalCode: null,
  addressCountry: null,
  profilePictures: [],
  accounts: [],
  bio: "Original bio",
  dateOfBirth: null,
  pronouns: "she/her",
  showAge: true,
  showExactBirthdate: false,
  socialLinks: { telegram: "orig_handle" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function setupFetch(status = 200) {
  const mock = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({}), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/profile');
});

describe("Profile settings tabs", () => {
  it("warns attendees about missing billing details before ticket sales", () => {
    render(<ProfilePageClient user={BASE_USER} />);
    expect(screen.getByText(/Complete your legal name and billing address before ticket sales open/)).toBeInTheDocument();
    expect(screen.getByText("Add billing address")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complete now" })).toHaveAttribute("href", "/complete-profile?intent=billing&callbackUrl=%2Fprofile");
  });

  it("hides the booking warning for saved, complete details", () => {
    render(<ProfilePageClient user={{ ...BASE_USER, legalName: "Jane Doe", addressLine1: "Main St 1", addressCity: "Berlin", addressPostalCode: "10115", addressCountry: "DE" }} />);
    expect(screen.queryByText(/Complete your legal name and billing address before ticket sales open/)).not.toBeInTheDocument();
    expect(screen.getByText("Billing details added")).toBeInTheDocument();
  });

  it("marks check-in ready only after saving a legal name, without requiring an address", async () => {
    setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByText('Add check-in name'));
    fireEvent.click(screen.getByRole('button', { name: /Check-in Identity/ }));
    fireEvent.change(screen.getByLabelText('Legal Name'), { target: { value: 'Jane Doe' } });
    expect(screen.queryByText('Check-in ready')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Check-in ready');
  });
  it("defaults events to private and saves the public visibility choice", async () => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Personal information' }));
    const toggle = screen.getByLabelText('Show all my events publicly');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      id: BASE_USER.id, showConventions: true,
    });
  });

  it("keeps edits across tabs and saves changes from multiple sections together", async () => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Telegram')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Socials' }));
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: '@new_handle' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Personal information' }));
    expect(screen.getByLabelText('Date of Birth')).toBeInTheDocument();
    expect(screen.getByLabelText('Show my age publicly')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByLabelText('Display Name')).toHaveValue('Alice Updated');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      id: BASE_USER.id, name: 'Alice Updated', socialLinks: { telegram: 'new_handle' },
    });
  });

  it("places export and deletion in Advanced, with no profile save button", () => {
    render(<ProfilePageClient user={BASE_USER} />);
    expect(screen.queryByRole('button', { name: 'Delete Account' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    expect(screen.getByRole('button', { name: 'Download Data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it("keeps personal account fields hidden for organizations", () => {
    render(<ProfilePageClient user={BASE_USER} isOrganization />);
    fireEvent.click(screen.getByRole('tab', { name: 'Personal information' }));
    expect(screen.getByText('Organization Details')).toBeInTheDocument();
    expect(screen.queryByLabelText('Date of Birth')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show my age publicly')).not.toBeInTheDocument();
  });
});

describe('Social link previews', () => {
  it.each([
    ['Telegram', 'https://t.me/'],
    ['Twitter / X', 'https://x.com/'],
    ['Instagram', 'https://instagram.com/'],
  ])('updates the %s link immediately, without saving', (label, baseUrl) => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Socials' }));

    fireEvent.change(screen.getByLabelText(label), { target: { value: '@new_handle' } });
    const link = screen.getByRole('link', { name: `${baseUrl}new_handle` });
    expect(link).toHaveAttribute('href', `${baseUrl}new_handle`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.change(screen.getByLabelText(label), { target: { value: 'updated_handle' } });
    expect(screen.queryByRole('link', { name: `${baseUrl}new_handle` })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${baseUrl}updated_handle` })).toHaveAttribute('href', `${baseUrl}updated_handle`);

    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    expect(screen.queryByRole('link', { name: new RegExp(baseUrl) })).not.toBeInTheDocument();
    expect(screen.getByText(`${baseUrl}username`)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews existing handles and keeps special characters within the username', () => {
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Socials' }));
    expect(screen.getByRole('link', { name: 'https://t.me/orig_handle' })).toHaveAttribute('href', 'https://t.me/orig_handle');
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: ' alice?start=123 ' } });
    expect(screen.getByRole('link', { name: 'https://t.me/alice%3Fstart%3D123' })).toHaveAttribute('href', 'https://t.me/alice%3Fstart%3D123');
  });
});

describe("Profile email change", () => {
  it("restores the authentication tab after verification", () => {
    window.history.replaceState({}, '', '/profile?tab=auth');
    render(<ProfilePageClient user={BASE_USER} />);
    expect(screen.getByRole('tab', { name: 'Authentication' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/new email address/i)).toBeInTheDocument();
  });

  it("requests verification without changing the displayed email", async () => {
    changeEmailMock.mockResolvedValue({ data: { status: true }, error: null });
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Authentication' }));
    fireEvent.change(screen.getByLabelText(/new email address/i), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));

    await waitFor(() => expect(changeEmailMock).toHaveBeenCalledWith({
      newEmail: 'new@example.com', callbackURL: '/profile?tab=auth',
    }));
    expect(await screen.findByText(/Request received/)).toBeInTheDocument();
    expect(screen.getByText(/Current email: alice@example.com/)).toBeInTheDocument();
  });

  it("disables empty and unchanged email addresses", () => {
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Authentication' }));
    expect(screen.getByRole('button', { name: 'Change Email' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new email address/i), { target: { value: 'ALICE@example.com' } });
    expect(screen.getByRole('button', { name: 'Change Email' })).toBeDisabled();
  });

  it("shows authentication errors without claiming an email was sent", async () => {
    changeEmailMock.mockResolvedValue({ error: { message: 'Please sign in again' } });
    render(<ProfilePageClient user={BASE_USER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Authentication' }));
    fireEvent.change(screen.getByLabelText(/new email address/i), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));
    expect(await screen.findByText('Please sign in again')).toBeInTheDocument();
    expect(screen.queryByText(/Request received/)).not.toBeInTheDocument();
  });
});

describe("ProfilePageClient PATCH diffing", () => {
  it("sends only the changed field on save", async () => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "Alice Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/user");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toEqual({ id: "user-1", name: "Alice Updated" });
  });

  it("skips the network call entirely when nothing changed", async () => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/save changes/i)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates the diff baseline after a successful save, so a second unrelated edit only sends the new field", async () => {
    const fetchMock = setupFetch();
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "Alice Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Bio"), {
      target: { value: "New bio text" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, options] = fetchMock.mock.calls[1];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toEqual({ id: "user-1", bio: "New bio text" });
  });
});

function setupRoutedFetch(handlers: Record<string, { status: number; body?: unknown }>) {
  const mock = vi.fn(async (url: string, _options?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const handler = handlers[path] ?? { status: 200 };
    return new Response(JSON.stringify(handler.body ?? {}), { status: handler.status });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("ProfilePageClient username changes", () => {
  it("calls the dedicated username endpoint before the general profile PATCH", async () => {
    const fetchMock = setupRoutedFetch({
      "/api/user/username": { status: 200 },
      "/api/user": { status: 200 },
    });
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice-new" } });
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Alice Updated" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [firstUrl, firstOptions] = fetchMock.mock.calls[0];
    expect(new URL(firstUrl as string, "http://localhost").pathname).toBe("/api/user/username");
    expect(JSON.parse((firstOptions as RequestInit).body as string)).toEqual({ username: "alice-new" });

    const [secondUrl] = fetchMock.mock.calls[1];
    expect(new URL(secondUrl as string, "http://localhost").pathname).toBe("/api/user");
  });

  it("skips the username endpoint entirely when the username is unchanged", async () => {
    const fetchMock = setupRoutedFetch({ "/api/user": { status: 200 } });
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Alice Updated" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new URL(fetchMock.mock.calls[0][0] as string, "http://localhost").pathname).toBe("/api/user");
  });

  it("surfaces a 409 from the username endpoint and does not proceed to the profile PATCH", async () => {
    const fetchMock = setupRoutedFetch({
      "/api/user/username": { status: 409, body: { error: "Username already taken" } },
    });
    render(<ProfilePageClient user={BASE_USER} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "taken-name" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("Username already taken")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
