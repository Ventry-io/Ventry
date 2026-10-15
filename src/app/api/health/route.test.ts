import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({
  prisma: vi.fn(),
  stripe: vi.fn(),
  giphy: vi.fn(),
  supabase: vi.fn(),
  mail: vi.fn(),
}));

vi.mock("@/lib/prisma/prisma", () => ({ prisma: { $queryRaw: checks.prisma } }));
vi.mock("@/lib/stripe", () => ({ stripe: { accounts: { retrieve: checks.stripe } } }));
vi.mock("@/lib/mail", () => ({ mailTransport: { verify: checks.mail } }));
vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@giphy/js-fetch-api", () => ({
  GiphyFetch: vi.fn(function () { return { trending: checks.giphy }; }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { getBucket: checks.supabase },
  }),
}));

let GET: typeof import("./route").GET;

describe("GET /api/health", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    vi.stubEnv("GIPHY_API_KEY", "test-key");
    vi.stubEnv("CACHE_TTL_MS", "60000");
    vi.stubEnv("SUPABASE_BUCKET_ID", "profile-test");
    vi.stubEnv("SUPABASE_BANNERS_BUCKET_ID", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.values(checks).forEach((check) => check.mockReset().mockResolvedValue(true));
    checks.supabase.mockResolvedValue({ error: null });
    ({ GET } = await import("./route"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs checks concurrently and reports each duration plus total duration", async () => {
    checks.prisma.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30)));
    checks.stripe.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 70)));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(0);
    for (const check of Object.values(checks)) {
      expect(check).toHaveBeenCalledTimes(check === checks.supabase ? 2 : 1);
    }
    expect(checks.supabase.mock.calls).toEqual([["profile-test"], ["banners"]]);
    await vi.advanceTimersByTimeAsync(70);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.status).toBe("ok");
    expect(body.cacheTtlMs).toBe(60_000);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.durationMs).toBe(70);
    expect(body.fuses).toEqual({
      prisma: { success: true, durationMs: 30 },
      stripe: { success: true, durationMs: 70 },
      giphy: { success: true, durationMs: 0 },
      supabase: { success: true, durationMs: 0 },
      mail: { success: true, durationMs: 0 },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(checks) as (keyof typeof checks)[])("isolates a rejected %s check", async (name) => {
    checks[name].mockRejectedValue(Object.assign(new Error("Sensitive provider details"), { code: "ECONNREFUSED" }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.fuses[name]).toEqual({
      success: false, durationMs: 0, error: `Health check ${name} failed`, code: "ECONNREFUSED",
    });
    for (const other of Object.keys(checks).filter((key) => key !== name)) {
      expect(body.fuses[other]).toEqual({ success: true, durationMs: 0 });
    }
    expect(JSON.stringify(body)).not.toContain("Sensitive provider details");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a missing banner bucket even when the profile bucket is healthy", async () => {
    checks.supabase.mockImplementation(async (bucket) => ({
      error: bucket === "banners" ? { code: "NoSuchBucket", message: "Bucket not found" } : null,
    }));
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.supabase).toMatchObject({ success: false, code: "NoSuchBucket" });
  });

  it("uses the configured banner bucket", async () => {
    vi.stubEnv("SUPABASE_BANNERS_BUCKET_ID", "event-banners");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(checks.supabase.mock.calls).toEqual([["profile-test"], ["event-banners"]]);
  });

  it("checks a shared storage bucket only once", async () => {
    vi.stubEnv("SUPABASE_BANNERS_BUCKET_ID", "profile-test");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(checks.supabase).toHaveBeenCalledExactlyOnceWith("profile-test");
  });

  it("reports a missing profile bucket configuration", async () => {
    vi.stubEnv("SUPABASE_BUCKET_ID", "");
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.supabase).toMatchObject({ success: false, code: "MISSING_BUCKET_ID" });
    expect(checks.supabase).not.toHaveBeenCalledWith("");
  });

  it("handles synchronous throws without exposing provider messages or malformed codes", async () => {
    checks.mail.mockImplementation(() => { throw { message: "smtp://user:secret@host", code: "smtp://secret" }; });
    const response = await GET();
    expect((await response.json()).fuses.mail).toEqual({
      success: false, durationMs: 0, error: "Health check mail failed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats false results as failures", async () => {
    checks.mail.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.mail.success).toBe(false);
  });

  it("reports a missing Giphy API key without making a Giphy request", async () => {
    vi.stubEnv("GIPHY_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.giphy).toMatchObject({ success: false, code: "MISSING_API_KEY" });
    expect(checks.giphy).not.toHaveBeenCalled();
  });

  it("returns completed results when a dependency exceeds the deadline", async () => {
    checks.stripe.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.durationMs).toBe(10_000);
    expect(body.fuses.stripe).toMatchObject({ success: false, durationMs: 10_000, code: "HEALTH_CHECK_TIMEOUT" });
    expect(body.fuses.prisma).toEqual({ success: true, durationMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reuses results until the 60-second cache expires", async () => {
    const first = await GET();
    const original = await first.json();
    checks.mail.mockResolvedValue(false);

    await vi.advanceTimersByTimeAsync(59_999);
    const cached = await GET();
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual(original);
    expect(checks.mail).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const refreshed = await GET();
    expect(refreshed.status).toBe(500);
    expect((await refreshed.json()).fuses.mail.success).toBe(false);
    expect(checks.mail).toHaveBeenCalledTimes(2);
  });

  it("uses CACHE_TTL_MS from the server environment", async () => {
    vi.stubEnv("CACHE_TTL_MS", "3000");
    vi.resetModules();
    ({ GET } = await import("./route"));
    const original = await (await GET()).json();
    expect(original.cacheTtlMs).toBe(3_000);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(await (await GET()).json()).toEqual(original);
    expect(checks.mail).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const refreshed = await (await GET()).json();
    expect(refreshed.timestamp).not.toBe(original.timestamp);
    expect(checks.mail).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "", "invalid", "0", "-1", "Infinity", "1.5"])(
    "falls back to 30 seconds for CACHE_TTL_MS=%s",
    async (value) => {
      vi.stubEnv("CACHE_TTL_MS", value);
      vi.resetModules();
      ({ GET } = await import("./route"));
      await GET();

      await vi.advanceTimersByTimeAsync(29_999);
      await GET();
      expect(checks.mail).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      await GET();
      expect(checks.mail).toHaveBeenCalledTimes(2);
    },
  );

  it("shares one in-flight health check between concurrent requests", async () => {
    checks.prisma.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 70)));
    const pending = Promise.all(Array.from({ length: 20 }, () => GET()));
    await vi.advanceTimersByTimeAsync(70);
    const responses = await pending;
    const bodies = await Promise.all(responses.map((response) => response.json()));

    for (const body of bodies) expect(body).toEqual(bodies[0]);
    for (const check of Object.values(checks)) {
      expect(check).toHaveBeenCalledTimes(check === checks.supabase ? 2 : 1);
    }
  });

  it("caches failures and reports recovery after expiry", async () => {
    checks.mail.mockRejectedValue(new Error("SMTP unavailable"));
    expect((await GET()).status).toBe(500);
    checks.mail.mockResolvedValue(true);
    expect((await GET()).status).toBe(500);
    expect(checks.mail).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await GET()).status).toBe(200);
    expect(checks.mail).toHaveBeenCalledTimes(2);
  });

  it("starts the cache lifetime when the checks complete", async () => {
    checks.prisma.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    await vi.advanceTimersByTimeAsync(59_999);
    await GET();
    expect(checks.prisma).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await GET();
    expect(checks.prisma).toHaveBeenCalledTimes(2);
  });
});
