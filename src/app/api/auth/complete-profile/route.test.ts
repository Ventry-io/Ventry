import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  adminOrganization: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

const isUsernameAvailableMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user/unique-name", () => ({
  isUsernameAvailable: isUsernameAvailableMock,
}));

const changeUsernameMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user/change-username", () => ({
  changeUsername: changeUsernameMock,
}));

const importOAuthProfilePictureMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user/profilePicture", () => ({
  importOAuthProfilePicture: importOAuthProfilePictureMock,
}));

import { POST } from "@/app/api/auth/complete-profile/route";
import { getSession } from "@/lib/auth/session";
import { middleware as profileCompletion } from "@/middlewares/profileCompletion";

const mockedGetSession = getSession as unknown as ReturnType<typeof vi.fn>;

const USER_ID = "user-1";
const SESSION = { user: { id: USER_ID } };

const VALID_ATTENDEE_BODY = {
  legalName: "Jane Doe",
  addressLine1: "123 Main St",
  addressCity: "Berlin",
  addressPostalCode: "10115",
  addressCountry: "DE",
  path: "ATTENDEE",
};

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/complete-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSession.mockResolvedValue(SESSION);
  prismaMock.user.findUnique.mockResolvedValue({ username: "current-username", image: null });
  isUsernameAvailableMock.mockResolvedValue(true);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      user: { update: vi.fn() },
      admin: { findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: "admin-1" }) },
      adminOrganization: { create: vi.fn() },
    }),
  );
});

describe("POST /api/auth/complete-profile - username handling", () => {
  it.each(["/privacy", "/imprint", "/profile", "/events/42"])("keeps %s accessible without check-in identity", async (path) => {
    const res = await profileCompletion(new NextRequest(`https://local.dev:3443${path}`, { headers: { cookie: "VENTRY.session_token=test" } }));
    expect(res.status).toBe(200);
    expect(mockedGetSession).not.toHaveBeenCalled();
  });

  it("preserves the event registration destination when requesting booking details", async () => {
    const res = await profileCompletion(new NextRequest("https://local.dev:3443/events/42/register?ticket=basic", { headers: { cookie: "__Secure-VENTRY.session_token=test" } }));
    const destination = new URL(res.headers.get("location")!);
    expect(destination.pathname).toBe("/complete-profile");
    expect(destination.searchParams.get("intent")).toBe("billing");
    expect(destination.searchParams.get("callbackUrl")).toBe("/events/42/register?ticket=basic");
  });
  it("lets prepared users enter ticket selection directly", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ legalName: "Jane Doe", addressLine1: "Main St 1", addressCity: "Berlin", addressPostalCode: "10115", addressCountry: "DE" });
    const res = await profileCompletion(new NextRequest("https://local.dev:3443/events/42/register", { headers: { cookie: "VENTRY.session_token=test" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("requests billing details even when the check-in name is already present", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ legalName: "Jane Doe" });
    const res = await profileCompletion(new NextRequest("https://local.dev:3443/events/42/register", { headers: { cookie: "VENTRY.session_token=test" } }));
    expect(new URL(res.headers.get("location")!).searchParams.get("intent")).toBe("billing");
  });

  it("lets attendees finish without collecting legal or address details", async () => {
    const res = await POST(postRequest({ username: "attendee-user", path: "ATTENDEE" }));
    expect(res.status).toBe(200);
  });

  it("still requires billing identity for organizers", async () => {
    const res = await POST(postRequest({ path: "ORGANIZER", organizerType: "INDIVIDUAL" }));
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("401s when unauthenticated", async () => {
    mockedGetSession.mockResolvedValue(null);
    const res = await POST(postRequest(VALID_ATTENDEE_BODY));
    expect(res.status).toBe(401);
  });

  it("400s on username containing spaces", async () => {
    const res = await POST(postRequest({ ...VALID_ATTENDEE_BODY, username: "new name" }));
    expect(res.status).toBe(400);
  });

  it("skips username handling entirely when no username is submitted", async () => {
    const res = await POST(postRequest(VALID_ATTENDEE_BODY));
    expect(res.status).toBe(200);
    expect(isUsernameAvailableMock).not.toHaveBeenCalled();
    expect(changeUsernameMock).not.toHaveBeenCalled();
  });

  it("409s when the chosen username is already taken", async () => {
    isUsernameAvailableMock.mockResolvedValue(false);

    const res = await POST(postRequest({ ...VALID_ATTENDEE_BODY, username: "taken-name" }));

    expect(res.status).toBe(409);
    expect(changeUsernameMock).not.toHaveBeenCalled();
  });

  it("calls changeUsername (reserving the old handle) when the username is available", async () => {
    isUsernameAvailableMock.mockResolvedValue(true);

    const res = await POST(postRequest({ ...VALID_ATTENDEE_BODY, username: "new-name" }));

    expect(res.status).toBe(200);
    expect(isUsernameAvailableMock).toHaveBeenCalledWith("new-name", USER_ID);
    expect(changeUsernameMock).toHaveBeenCalledWith(USER_ID, "new-name");
  });

  it("imports the OAuth profile picture when requested and available", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ username: "current-username", image: "https://example.com/avatar.png" });
    importOAuthProfilePictureMock.mockResolvedValue(undefined);

    const res = await POST(postRequest({ ...VALID_ATTENDEE_BODY, importProfilePicture: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pictureImported).toBe(true);
    expect(importOAuthProfilePictureMock).toHaveBeenCalledWith(USER_ID, "https://example.com/avatar.png");
  });

  it("does not fail the request when the avatar import throws", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ username: "current-username", image: "https://example.com/avatar.png" });
    importOAuthProfilePictureMock.mockRejectedValue(new Error("fetch failed"));

    const res = await POST(postRequest({ ...VALID_ATTENDEE_BODY, importProfilePicture: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pictureImported).toBe(false);
  });
});
