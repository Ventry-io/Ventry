import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  account: {
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/bcrypt", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-password"),
}));

const mockedCheckPasswordStrength = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/password-strength", () => ({
  checkPasswordStrength: mockedCheckPasswordStrength,
}));

import * as userRoute from "@/app/api/user/route";
import { getSession } from "@/lib/auth/session";

const mockedGetSession = getSession as unknown as ReturnType<typeof vi.fn>;

function patchRequest(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new NextRequest("http://localhost/api/user", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function postRequest(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new NextRequest("http://localhost/api/user", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function deleteRequest(url: string) {
  return new NextRequest(url, { method: "DELETE" });
}

function getRequest(url: string) {
  return new NextRequest(url, { method: "GET" });
}

const VALID_REGISTRATION = {
  name: "Valid Name",
  email: "valid@example.com",
  password: "Str0ngPassword!",
};

describe("App Router: /api/user PATCH", () => {
  it.each([true, false])("persists convention visibility %s", async (showConventions) => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", accounts: [] });
    prismaMock.user.update.mockResolvedValue({ id: "user-1", showConventions });
    const response = await userRoute.PATCH(patchRequest({ id: "user-1", showConventions }));
    expect(response.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { showConventions }, select: expect.objectContaining({ showConventions: true }),
    }));
    await expect(response.json()).resolves.toMatchObject({ showConventions });
  });

  it("rejects non-boolean convention visibility", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await userRoute.PATCH(patchRequest({ id: "user-1", showConventions: "true" }));
    expect(response.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    mockedGetSession.mockResolvedValue(null);

    const response = await userRoute.PATCH(patchRequest({ id: "user-1", name: "User" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("requires JSON content", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({ id: "user-1", name: "User" }, { "content-type": "text/plain" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid content type" });
  });

  it("prevents users from updating another profile", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(patchRequest({ id: "user-2", name: "Other User" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden - You can only update your own profile",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("allows clearing optional country fields", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      accounts: [],
    });
    prismaMock.user.update.mockImplementation(({ data }) => ({
      id: "user-1",
      ...data,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }));

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        name: "Valid Name",
        country: null,
        addressCountry: null,
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      id: "user-1",
      country: null,
      addressCountry: null,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          country: null,
          addressCountry: null,
        }),
      }),
    );
  });

  it("rejects email updates that bypass verification", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await userRoute.PATCH(patchRequest({ id: "user-1", email: "new@example.com" }));
    expect(response.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("normalizes country fields to ISO country codes", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      accounts: [],
    });
    prismaMock.user.update.mockImplementation(({ data }) => ({
      id: "user-1",
      ...data,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }));

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        name: "Valid Name",
        country: "us",
        addressCountry: "Germany",
      }),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          country: "US",
          addressCountry: "DE",
        }),
      }),
    );
  });

  it("rejects unchecked country values before updating the user", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        country: "Narnia",
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.country.errors).toContain("Select a valid country");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects overlong country values before updating the user", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        addressCountry: "X".repeat(200),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.addressCountry.errors).toContain("Country is too long");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects future birth dates before updating the user", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        dateOfBirth: nextYear.toISOString(),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.dateOfBirth.errors).toContain("Birth date must be realistic");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects unrealistically old birth dates before updating the user", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        dateOfBirth: "1000-01-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.dateOfBirth.errors).toContain("Birth date must be realistic");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("returns validation errors for invalid profile fields", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        country: 123,
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.country.errors).toContain("Invalid input: expected string, received number");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["name", "a", "Too small: expected string to have >=2 characters"],
    ["legalName", "X".repeat(201), "Too big: expected string to have <=200 characters"],
    ["addressLine1", "X".repeat(201), "Too big: expected string to have <=200 characters"],
    ["addressLine2", "X".repeat(201), "Too big: expected string to have <=200 characters"],
    ["addressCity", "X".repeat(121), "Too big: expected string to have <=120 characters"],
    ["addressState", "X".repeat(121), "Too big: expected string to have <=120 characters"],
    ["addressPostalCode", "X".repeat(41), "Too big: expected string to have <=40 characters"],
    ["bio", "X".repeat(501), "Too big: expected string to have <=500 characters"],
    ["pronouns", "X".repeat(51), "Too big: expected string to have <=50 characters"],
  ])("rejects an overlong %s before updating the user", async (field, value, expectedError) => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        [field]: value,
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties[field].errors).toContain(expectedError);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects overlong nested socialLinks values before updating the user", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.PATCH(
      patchRequest({
        id: "user-1",
        socialLinks: { telegram: "X".repeat(101) },
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.properties.socialLinks.properties.telegram.errors).toContain(
      "Too big: expected string to have <=100 characters",
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("App Router: /api/user POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCheckPasswordStrength.mockReturnValue({
      isStrong: true,
      feedback: { warning: "", suggestions: [] },
      strengthText: "Strong",
      score: 4,
    });
  });

  it("requires JSON content", async () => {
    const response = await userRoute.POST(
      postRequest(VALID_REGISTRATION, { "content-type": "text/plain" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid content type" });
  });

  it("rejects an invalid email", async () => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, email: "not-an-email" }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.email._errors.length).toBeGreaterThan(0);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects a name shorter than 2 characters", async () => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, name: "a" }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.name._errors.length).toBeGreaterThan(0);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, password: "short1" }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.password._errors.length).toBeGreaterThan(0);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid addressCountry", async () => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, addressCountry: "Narnia" }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.addressCountry._errors).toContain("Select a valid country");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    ["legalName", "X".repeat(201)],
    ["addressLine1", "X".repeat(201)],
    ["addressCity", "X".repeat(121)],
    ["addressPostalCode", "X".repeat(41)],
  ])("rejects an overlong %s", async (field, value) => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, [field]: value }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error[field]._errors.length).toBeGreaterThan(0);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects unknown fields due to strict schema", async () => {
    const response = await userRoute.POST(
      postRequest({ ...VALID_REGISTRATION, isAdmin: true }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects registration when the email is already in use", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing-user" });

    const response = await userRoute.POST(postRequest(VALID_REGISTRATION));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Email is already in use" });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects a weak password even when the schema is otherwise valid", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    mockedCheckPasswordStrength.mockReturnValue({
      isStrong: false,
      feedback: { warning: "Too common", suggestions: ["Use a longer password"] },
      strengthText: "Weak",
      score: 1,
    });

    const response = await userRoute.POST(postRequest(VALID_REGISTRATION));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("Password is too weak");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("creates a user when all data is valid", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      ...VALID_REGISTRATION,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await userRoute.POST(postRequest(VALID_REGISTRATION));

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: VALID_REGISTRATION.name,
          email: VALID_REGISTRATION.email,
        }),
      }),
    );
  });
});

describe("App Router: /api/user GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the requested user does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await userRoute.GET(
      getRequest("http://localhost/api/user?userId=missing-user"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "User not found" });
  });

  it("returns the requested user by id", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "Valid Name" });

    const response = await userRoute.GET(
      getRequest("http://localhost/api/user?userId=user-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("App Router: /api/user DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    mockedGetSession.mockResolvedValue(null);

    const response = await userRoute.DELETE(
      deleteRequest("http://localhost/api/user?userId=user-1"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("requires a userId query parameter", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.DELETE(deleteRequest("http://localhost/api/user"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "User ID is required" });
  });

  it("prevents users from deleting another user's account", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await userRoute.DELETE(
      deleteRequest("http://localhost/api/user?userId=user-2"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden - You can only delete your own account",
    });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("deletes the user's own account", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });

    const response = await userRoute.DELETE(
      deleteRequest("http://localhost/api/user?userId=user-1"),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });
});
