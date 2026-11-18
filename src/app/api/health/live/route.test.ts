import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma/prisma", () => { throw new Error("liveness must not load Prisma"); });
vi.mock("@/lib/redis", () => { throw new Error("liveness must not load Redis"); });
vi.mock("@/lib/auth/session", () => { throw new Error("liveness must not load sessions"); });
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  connection: vi.fn().mockResolvedValue(undefined),
}));

describe("GET /api/health/live", () => {
  it("responds without touching dependencies", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
