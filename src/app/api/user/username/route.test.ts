import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  usernameHistory: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/user/username/route";
import { getSession } from "@/lib/auth/session";

const mockedGetSession = getSession as unknown as ReturnType<typeof vi.fn>;

function patchRequest(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new NextRequest("http://localhost/api/user/username", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

const SESSION = { user: { id: "user-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
});

describe("PATCH /api/user/username", () => {
  it("checks public username availability without caching the result", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.usernameHistory.findFirst.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/user/username?username=available-name"));
    expect(await res.json()).toEqual({ available: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unsafe username characters before querying availability", async () => {
    const res = await GET(new NextRequest("http://localhost/api/user/username?username=bad%2Fname"));
    expect(res.status).toBe(400);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });
  it("401s when unauthenticated", async () => {
    mockedGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ username: "new-name" }));
    expect(res.status).toBe(401);
  });

  it("400s on non-JSON content type", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    const res = await PATCH(patchRequest({ username: "new-name" }, {}));
    expect(res.status).toBe(400);
  });

  it("400s on invalid username (too short)", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    const res = await PATCH(patchRequest({ username: "a" }));
    expect(res.status).toBe(400);
  });

  it("400s on username containing spaces", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    const res = await PATCH(patchRequest({ username: "new name" }));
    expect(res.status).toBe(400);
  });

  it("no-ops with 200 when username is unchanged", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    prismaMock.user.findUnique.mockResolvedValue({ username: "current-name" });

    const res = await PATCH(patchRequest({ username: "current-name" }));

    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("409s when the username is already taken by another user", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    prismaMock.user.findUnique.mockResolvedValue({ username: "current-name" });
    prismaMock.user.findFirst.mockResolvedValue({ id: "other-user" });
    prismaMock.usernameHistory.findFirst.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ username: "taken-name" }));

    expect(res.status).toBe(409);
  });

  it("409s when the username is still reserved by a recent rename", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    prismaMock.user.findUnique.mockResolvedValue({ username: "current-name" });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.usernameHistory.findFirst.mockResolvedValue({ id: "reservation-1" });

    const res = await PATCH(patchRequest({ username: "reserved-name" }));

    expect(res.status).toBe(409);
  });

  it("changes the username and reserves the old one on success", async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ username: "current-name" }) // route's own lookup
      .mockResolvedValueOnce({ username: "current-name" }); // changeUsername's tx lookup
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.usernameHistory.findFirst.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ username: "new-name" }));

    expect(res.status).toBe(200);
    expect(prismaMock.usernameHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: "current-name", userId: "user-1" }),
    });
  });
});
