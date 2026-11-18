import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  adminOrganization: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  api: {
    signUpEmail: vi.fn(),
  },
}));

vi.mock("@/lib/prisma/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock("@/app/api/auth/auth", () => ({
  auth: authMock,
}));

import * as registerOrganizerRoute from "@/app/api/auth/register-organizer/route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/register-organizer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_INDIVIDUAL = {
  email: "organizer@example.com",
  username: "Organizer-Name",
  password: "Str0ngPassword!",
  legalName: "Organizer Legal Name",
  addressLine1: "123 Main St",
  addressCity: "Berlin",
  addressPostalCode: "10115",
  addressCountry: "DE",
  organizerType: "INDIVIDUAL",
};

const VALID_ORGANIZATION = {
  ...VALID_INDIVIDUAL,
  organizerType: "ORGANIZATION",
  orgName: "Acme Events",
  orgSlug: "acme-events",
};

describe("App Router: /api/auth/register-organizer POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.adminOrganization.findUnique.mockResolvedValue(null);
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: vi.fn() },
        admin: { create: vi.fn().mockResolvedValue({ id: "admin-1" }) },
        adminOrganization: { create: vi.fn() },
      }),
    );
  });

  it("keeps a created account usable when organizer setup needs to be retried", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error("Connection interrupted"));
    const response = await registerOrganizerRoute.POST(postRequest({ ...VALID_INDIVIDUAL, callbackURL: "/events/42" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, organizerSetupPending: true });
    expect(authMock.api.signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ callbackURL: "/complete-profile?intent=organizer&callbackUrl=%2Fevents%2F42" }),
    }));
  });

  it("rejects invalid JSON", async () => {
    const response = await registerOrganizerRoute.POST(
      new NextRequest("http://localhost/api/auth/register-organizer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("rejects an invalid email", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, email: "not-an-email" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a username shorter than 3 characters", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, username: "ab" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a weak password missing an uppercase letter or number", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, password: "lowercaseonly" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid addressCountry", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, addressCountry: "Narnia" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["legalName", "X".repeat(201)],
    ["addressLine1", "X".repeat(201)],
    ["addressLine2", "X".repeat(201)],
    ["addressCity", "X".repeat(121)],
    ["addressState", "X".repeat(121)],
    ["addressPostalCode", "X".repeat(41)],
  ])("rejects an overlong %s", async (field, value) => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, [field]: value }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an organization signup missing orgName and orgSlug", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_INDIVIDUAL, organizerType: "ORGANIZATION" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid orgSlug format", async () => {
    const response = await registerOrganizerRoute.POST(
      postRequest({ ...VALID_ORGANIZATION, orgSlug: "Not A Valid Slug!" }),
    );

    expect(response.status).toBe(400);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects registration when the email is already in use", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing-user" });

    const response = await registerOrganizerRoute.POST(postRequest(VALID_INDIVIDUAL));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An account with this email already exists.",
    });
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects registration when the org slug is already taken", async () => {
    prismaMock.adminOrganization.findUnique.mockResolvedValue({ id: "existing-org" });

    const response = await registerOrganizerRoute.POST(postRequest(VALID_ORGANIZATION));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Organization slug already taken" });
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it("returns 500 when account creation fails", async () => {
    authMock.api.signUpEmail.mockResolvedValue(null);

    const response = await registerOrganizerRoute.POST(postRequest(VALID_INDIVIDUAL));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Account creation failed" });
  });

  it("creates an individual organizer when all data is valid", async () => {
    const response = await registerOrganizerRoute.POST(postRequest(VALID_INDIVIDUAL));

    expect(response.status).toBe(201);
    expect(authMock.api.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: VALID_INDIVIDUAL.email,
          name: VALID_INDIVIDUAL.username,
          legalName: VALID_INDIVIDUAL.legalName,
        }),
      }),
    );
  });

  it("creates an organization organizer when all data is valid", async () => {
    const response = await registerOrganizerRoute.POST(postRequest(VALID_ORGANIZATION));

    expect(response.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});
