import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CompleteProfileWizard from "./CompleteProfileWizard";
import RegisterWizard from "./RegisterWizard";
import CheckEmail from "./CheckEmail";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signUp: vi.fn(),
  social: vi.fn(),
  resend: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/auth/client", () => ({ default: {
  $store: { notify: vi.fn() },
  signUp: { email: mocks.signUp },
  signIn: { social: mocks.social },
  sendVerificationEmail: mocks.resend,
} }));

async function fillAttendeeFlow() {
  fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "attendee-user" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  fireEvent.click(await screen.findByRole("radio", { name: /Attendee/ }));
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
}

describe("CompleteProfileWizard post-submit navigation", () => {
  let hrefSetter: (v: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signUp.mockResolvedValue({ error: null });
    mocks.resend.mockResolvedValue({ error: null });
    hrefSetter = vi.fn<(v: string) => void>();
    // jsdom throws "Not implemented: navigation" on a real location.href
    // assignment - stub the setter so we can assert on it instead.
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { hrefSetter(v); } },
      writable: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true, pictureImported: false }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does a hard navigation (not a client-side router transition) after a successful submit", async () => {
    render(<CompleteProfileWizard callbackUrl="/" />);

    await fillAttendeeFlow();

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/"));
  });

  it("navigates to the given callbackUrl", async () => {
    render(<CompleteProfileWizard callbackUrl="/events/42" />);

    await fillAttendeeFlow();

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/events/42"));
  });

  it("collects only the legal name when an event needs check-in identity", async () => {
    render(<CompleteProfileWizard checkInOnly defaultPersonal={{ addressLine1: "", addressCity: "", addressPostalCode: "", addressCountry: "" }} callbackUrl="/events/42/register" />);
    expect(screen.queryByLabelText(/^Address/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Legal name/), { target: { value: "Jane Doe" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/events/42/register"));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/auth/complete-profile");
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ legalName: "Jane Doe", path: "ATTENDEE" });
  });

  it("requires a billing address before resuming ticket selection and prefills saved details", async () => {
    render(<CompleteProfileWizard billingOnly defaultPersonal={{ legalName: "Jane Doe", addressCity: "Berlin", addressPostalCode: "10115", addressCountry: "DE" }} callbackUrl="/events/42/register" />);
    expect(screen.queryByLabelText(/^Username/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue("Jane Doe");
    expect(screen.getByText(/No ticket is reserved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText("Required");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Address \*/ ), { target: { value: "Main St 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/events/42/register"));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/auth/complete-profile");
    expect(JSON.parse(request?.[1]?.body as string)).toMatchObject({ legalName: "Jane Doe", addressLine1: "Main St 1", addressCity: "Berlin", addressPostalCode: "10115", addressCountry: "DE", path: "ATTENDEE" });
  });

  it("does not navigate away when the submit request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Username already taken" }), { status: 409 })),
    );

    render(<CompleteProfileWizard callbackUrl="/" />);

    await fillAttendeeFlow();

    await screen.findByText("Username already taken");
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it("creates an attendee account without an address and preserves the verification destination", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ exists: false, available: true }))));
    render(<RegisterWizard callbackUrl="/events/42/register" />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "jane-doe" } });
    fireEvent.change(screen.getByLabelText(/^Password/, { selector: "input" }), { target: { value: "Password1!" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Password/, { selector: "input" }), { target: { value: "Cedar9!RiverMosaic27" } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: "Cedar9!RiverMosaic27" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Attendee/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
      email: "jane@example.com", name: "jane-doe", password: "Cedar9!RiverMosaic27", callbackURL: "/events/42/register",
    }));
    expect(mocks.push).toHaveBeenCalledWith("/check-email?email=jane%40example.com&callbackUrl=%2Fevents%2F42%2Fregister");
  });

  it("offers OAuth registration and recovers when the provider cannot start", async () => {
    mocks.social.mockResolvedValue({ error: { message: "Provider unavailable" } });
    render(<RegisterWizard callbackUrl="/events/42/register" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await screen.findByText("Provider unavailable");
    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google", callbackURL: "/events/42/register", newUserCallbackURL: "/complete-profile?callbackUrl=%2Fevents%2F42%2Fregister",
    });
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("resends confirmation with the original destination and prevents repeated clicks", async () => {
    render(<CheckEmail email="jane@example.com" callbackUrl="/events/42/register" />);
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start registration with another email" })).toHaveAttribute("href", "/register?callbackUrl=%2Fevents%2F42%2Fregister");
    fireEvent.click(screen.getByRole("button", { name: "Resend confirmation link" }));
    await screen.findByText("If this address needs verification, we've sent a new link.");
    expect(mocks.resend).toHaveBeenCalledWith({ email: "jane@example.com", callbackURL: "/events/42/register" });
    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  });

  it("asks for an address when the confirmation page is opened without one", async () => {
    render(<CheckEmail callbackUrl="/profile" />);
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Resend confirmation link" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ email: "jane@example.com", callbackURL: "/profile" }));
  });
});
