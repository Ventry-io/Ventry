import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getSession = vi.hoisted(() => vi.fn());
const giphySearch = vi.hoisted(() => vi.fn());

const checks = vi.hoisted(() => ({
  prisma: vi.fn(),
  postgres: vi.fn(),
  redis: vi.fn(),
  stripe: vi.fn(),
  giphy: vi.fn(),
  supabase: vi.fn(),
  mail: vi.fn(),
}));

vi.mock("@/lib/prisma/prisma", () => ({ prisma: { $queryRaw: checks.prisma } }));
vi.mock("@/lib/pg-isready", () => ({ checkPostgresReady: checks.postgres }));
vi.mock("@/lib/redis", () => ({ pingRedis: checks.redis }));
vi.mock("@/lib/stripe", () => ({ stripe: { accounts: { retrieve: checks.stripe } } }));
vi.mock("@/lib/mail", () => ({ mailTransport: { verify: checks.mail } }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@giphy/js-fetch-api", () => ({
  GiphyFetch: vi.fn(function () { return { trending: checks.giphy, search: giphySearch }; }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { getBucket: checks.supabase },
  }),
}));

let GET: typeof import("./route").GET;
let searchGiphy: typeof import("../community/giphy/search/route").GET;

describe("GET /api/health", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    vi.stubEnv("GIPHY_API_KEY", "test-key");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
    vi.stubEnv("SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SMTP_HOST", "smtp.test");
    vi.stubEnv("GIPHY_CACHE_TTL_MS", "300000");
    vi.stubGlobal("ventryHealthSignals", undefined);
    vi.stubEnv("CACHE_TTL_MS", "60000");
    vi.stubEnv("SUPABASE_BUCKET_ID", "profile-test");
    vi.stubEnv("SUPABASE_BANNERS_BUCKET_ID", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.values(checks).forEach((check) => check.mockReset().mockResolvedValue(true));
    checks.supabase.mockResolvedValue({ error: null });
    getSession.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    giphySearch.mockReset().mockResolvedValue({ data: [{ id: "gif-1" }] });
    ({ GET } = await import("./route"));
    ({ GET: searchGiphy } = await import("../community/giphy/search/route"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    const healthy = (durationMs: number, required = false) => ({
      success: true, status: "healthy", required, durationMs, checkedAt: expect.any(String),
    });
    expect(body.fuses).toEqual({
      prisma: healthy(30, true),
      postgres: healthy(0, true),
      redis: healthy(0, true),
      stripe: healthy(70),
      giphy: healthy(0),
      supabase: healthy(0),
      mail: healthy(0),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(checks) as (keyof typeof checks)[])("isolates a rejected %s check", async (name) => {
    checks[name].mockRejectedValue(Object.assign(new Error("Sensitive provider details"), { code: "ECONNREFUSED" }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    // Required dependencies make the app unusable; the rest degrade single features.
    const required = ["prisma", "postgres", "redis"].includes(name);
    expect(body.status).toBe(required ? "error" : "degraded");
    expect(body.fuses[name]).toEqual({
      success: false, status: "unavailable", required, durationMs: 0, checkedAt: expect.any(String),
      error: `Health check ${name} failed`, code: "ECONNREFUSED",
    });
    for (const other of Object.keys(checks).filter((key) => key !== name)) {
      expect(body.fuses[other]).toMatchObject({ success: true, status: "healthy", durationMs: 0 });
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
      success: false, status: "unavailable", required: false, durationMs: 0, checkedAt: expect.any(String),
      error: "Health check mail failed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats false results as failures", async () => {
    checks.mail.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.mail.success).toBe(false);
  });

  it.each([
    ["stripe", "STRIPE_SECRET_KEY"],
    ["giphy", "GIPHY_API_KEY"],
    ["supabase", "SUPABASE_URL"],
    ["mail", "SMTP_HOST"],
  ] as const)("reports unconfigured optional %s as disabled without checking it", async (name, envVar) => {
    vi.stubEnv(envVar, "");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.fuses[name]).toEqual({ success: false, status: "disabled", required: false, durationMs: 0, code: "NOT_CONFIGURED" });
    expect(checks[name]).not.toHaveBeenCalled();
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
    expect(body.fuses.prisma).toMatchObject({ success: true, durationMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reuses results until the 60-second cache expires", async () => {
    const first = await GET();
    const original = await first.json();
    checks.mail.mockResolvedValue(false);

    await vi.advanceTimersByTimeAsync(59_999);
    const cached = await GET();
    expect(cached.status).toBe(200);
    expect((await cached.json()).fuses).toEqual(original.fuses);
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
    expect((await (await GET()).json()).fuses.mail).toEqual(original.fuses.mail);
    expect(checks.mail).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const refreshed = await (await GET()).json();
    expect(refreshed.fuses.mail.checkedAt).not.toBe(original.fuses.mail.checkedAt);
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
    checks.mail.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    await vi.advanceTimersByTimeAsync(59_999);
    await GET();
    expect(checks.mail).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await GET();
    expect(checks.mail).toHaveBeenCalledTimes(2);
  });

  it("checks Giphy only every five minutes while other checks keep refreshing", async () => {
    await GET();
    for (let minute = 1; minute < 5; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await GET()).status).toBe(200);
    }
    expect(checks.giphy).toHaveBeenCalledOnce();
    expect(checks.mail).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await GET()).status).toBe(200);
    expect(checks.giphy).toHaveBeenCalledTimes(2);
    expect(checks.mail).toHaveBeenCalledTimes(6);
  });

  it("caches Giphy failures for five minutes before checking for recovery", async () => {
    checks.giphy.mockRejectedValue(new Error("Rate limited"));
    expect((await GET()).status).toBe(500);
    checks.giphy.mockResolvedValue(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await GET()).status).toBe(500);
    expect(checks.giphy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(240_000);
    expect((await GET()).status).toBe(200);
    expect(checks.giphy).toHaveBeenCalledTimes(2);
  });

  it("preserves the original Giphy duration when reusing its result", async () => {
    checks.giphy.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 25)));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(25);
    const original = await (await pending).json();
    expect(original.fuses.giphy).toMatchObject({ success: true, durationMs: 25 });

    await vi.advanceTimersByTimeAsync(60_000);
    const refreshed = await (await GET()).json();
    expect(refreshed.fuses.giphy).toEqual(original.fuses.giphy);
    expect(checks.giphy).toHaveBeenCalledOnce();
  });

  it("caches Giphy timeouts instead of retrying on every health refresh", async () => {
    checks.giphy.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(10_000);
    const original = await (await pending).json();
    expect(original.fuses.giphy).toMatchObject({ success: false, code: "HEALTH_CHECK_TIMEOUT" });

    await vi.advanceTimersByTimeAsync(60_000);
    const refreshed = await (await GET()).json();
    expect(refreshed.fuses.giphy).toEqual(original.fuses.giphy);
    expect(checks.giphy).toHaveBeenCalledOnce();
  });

  it("uses actual search results instead of issuing a dedicated Giphy health request", async () => {
    const response = await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=cats"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ gifs: [{ id: "gif-1" }] });

    // Separate route bundles can load separate copies of the shared module.
    vi.resetModules();
    ({ GET } = await import("./route"));
    const health = await GET();
    expect(health.status).toBe(200);
    expect((await health.json()).fuses.giphy).toMatchObject({ success: true, durationMs: 0 });
    expect(checks.giphy).not.toHaveBeenCalled();
    expect(giphySearch).toHaveBeenCalledExactlyOnceWith("cats", { limit: 20, rating: "g" });
  });

  it("immediately reports search failures and recovery without rerunning other cached checks", async () => {
    expect((await GET()).status).toBe(200);
    const error = Object.assign(new Error("Sensitive provider details"), { code: "RATE_LIMITED" });
    giphySearch.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(error), 25)));
    const pending = searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=cats"));
    await vi.advanceTimersByTimeAsync(25);
    expect((await pending).status).toBe(502);

    const unhealthy = await GET();
    expect(unhealthy.status).toBe(500);
    const body = await unhealthy.json();
    expect(body.status).toBe("degraded");
    expect(body.fuses.giphy).toEqual({
      success: false, status: "unavailable", required: false, durationMs: 25, checkedAt: expect.any(String),
      error: "Health check giphy failed", code: "RATE_LIMITED",
    });
    expect(JSON.stringify(body)).not.toContain("Sensitive provider details");

    // Recovery needs a search that started after the failure was observed.
    await vi.advanceTimersByTimeAsync(1);
    expect((await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=dogs"))).status).toBe(200);
    const recovered = await GET();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).fuses.giphy).toMatchObject({ success: true, durationMs: 0 });
    expect(checks.prisma).toHaveBeenCalledOnce();
    expect(checks.mail).toHaveBeenCalledOnce();
    expect(checks.giphy).toHaveBeenCalledOnce();
  });

  it("records trending requests as Giphy health observations", async () => {
    checks.giphy.mockResolvedValue({ data: [] });
    expect((await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search"))).status).toBe(200);
    expect((await GET()).status).toBe(200);
    expect(checks.giphy).toHaveBeenCalledExactlyOnceWith({ limit: 20, rating: "g" });
  });

  it("does not mark Giphy unhealthy for unauthenticated requests", async () => {
    expect((await GET()).status).toBe(200);
    getSession.mockResolvedValue(null);
    expect((await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=cats"))).status).toBe(401);
    expect((await GET()).status).toBe(200);
    expect(giphySearch).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "invalid", "1.5"])("rejects invalid search limits without affecting Giphy health: %s", async (limit) => {
    expect((await GET()).status).toBe(200);
    const request = new NextRequest(`https://local.dev/api/community/giphy/search?q=cats&limit=${limit}`);
    expect((await searchGiphy(request)).status).toBe(400);
    expect((await GET()).status).toBe(200);
    expect(giphySearch).not.toHaveBeenCalled();
  });

  it("treats a removed Giphy key as disabled even after searches recorded it", async () => {
    expect((await GET()).status).toBe(200);
    vi.stubEnv("GIPHY_API_KEY", "");
    expect((await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=cats"))).status).toBe(503);
    const health = await GET();
    expect(health.status).toBe(200);
    expect((await health.json()).fuses.giphy).toMatchObject({ status: "disabled", code: "NOT_CONFIGURED" });
    expect(checks.prisma).toHaveBeenCalledOnce();
  });

  it("extends the configured 30-minute Giphy cache when actual searches run", async () => {
    vi.stubEnv("GIPHY_CACHE_TTL_MS", "1800000");
    vi.resetModules();
    ({ GET } = await import("./route"));
    ({ GET: searchGiphy } = await import("../community/giphy/search/route"));
    await GET();
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await searchGiphy(new NextRequest("https://local.dev/api/community/giphy/search?q=cats"));
    await GET();

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await GET();
    expect(checks.giphy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    await GET();
    expect(checks.giphy).toHaveBeenCalledTimes(2);
  });

  it("runs SELECT 1 at most once per hour while pg_isready and Redis refresh every minute", async () => {
    vi.stubEnv("CACHE_TTL_MS", "30000");
    vi.resetModules();
    ({ GET } = await import("./route"));
    for (let tick = 0; tick < 120; tick++) {
      expect((await GET()).status).toBe(200);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    // 120 polls over 60 minutes: one SQL check, one pg_isready/PING per minute.
    expect(checks.prisma).toHaveBeenCalledOnce();
    expect(checks.postgres).toHaveBeenCalledTimes(60);
    expect(checks.redis).toHaveBeenCalledTimes(60);
    expect(checks.mail).toHaveBeenCalledTimes(120);

    await GET();
    expect(checks.prisma).toHaveBeenCalledTimes(2);
  });

  it("reports the last SQL check time while reusing its result", async () => {
    const first = (await (await GET()).json()).fuses.prisma;
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    const cached = (await (await GET()).json()).fuses.prisma;
    expect(cached).toEqual(first);
    expect(Date.now() - Date.parse(cached.checkedAt)).toBe(59 * 60_000);
  });

  it("shares one in-flight SQL check across concurrent requests after the bundle cache expires", async () => {
    await GET();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    checks.prisma.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const pending = Promise.all(Array.from({ length: 10 }, () => GET()));
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(checks.prisma).toHaveBeenCalledTimes(2);
  });

  it("retries a failed SQL check after one minute instead of one hour", async () => {
    checks.prisma.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "P1001" }));
    const failed = await GET();
    expect(failed.status).toBe(500);
    expect((await failed.json()).status).toBe("error");

    await vi.advanceTimersByTimeAsync(59_999);
    expect((await GET()).status).toBe(500);
    expect(checks.prisma).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect((await GET()).status).toBe(200);
    expect(checks.prisma).toHaveBeenCalledTimes(2);
  });

  it("caches SQL timeouts as failures without overlapping checks", async () => {
    checks.prisma.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await (await pending).json()).fuses.prisma).toMatchObject({ status: "unavailable", code: "HEALTH_CHECK_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_000);
    await GET();
    expect(checks.prisma).toHaveBeenCalledOnce();
  });

  it.each([
    ["postgres", "PG_ISREADY_MISSING", "unknown"],
    ["redis", "REDIS_NOT_CONFIGURED", "unavailable"],
    ["postgres", "DATABASE_URL_MISSING", "unavailable"],
  ] as const)("fails when required %s cannot be verified (%s)", async (name, code, state) => {
    checks[name].mockRejectedValue(Object.assign(new Error("not verifiable"), { code }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.fuses[name]).toMatchObject({ success: false, status: state, required: true, code });
  });

  it("does not require pg_isready when Prisma Accelerate has no PostgreSQL socket", async () => {
    checks.postgres.mockRejectedValue(Object.assign(new Error("n/a"), { code: "PG_ISREADY_NOT_APPLICABLE" }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.fuses.postgres).toMatchObject({ status: "disabled", code: "PG_ISREADY_NOT_APPLICABLE" });
  });

  it("never reports ok before the initial checks finish", async () => {
    checks.prisma.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const pending = GET().then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(500);
    expect((await response.json()).fuses.prisma).toMatchObject({ status: "unavailable", code: "HEALTH_CHECK_TIMEOUT" });
  });

  it("never reports an expired SQL success as healthy when the refresh hangs", async () => {
    expect((await GET()).status).toBe(200);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    checks.prisma.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.fuses.prisma).toMatchObject({ status: "unavailable", code: "HEALTH_CHECK_TIMEOUT" });
  });

  it.each(["postgres", "redis"] as const)("refreshes an expired %s success and reports a new failure", async (name) => {
    expect((await GET()).status).toBe(200);
    checks[name].mockRejectedValue(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect((await GET()).status).toBe(200);
    await vi.advanceTimersByTimeAsync(1);
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).fuses[name]).toMatchObject({ status: "unavailable", code: "ECONNREFUSED" });
    expect(checks[name]).toHaveBeenCalledTimes(2);
  });

  it.each(["postgres", "redis"] as const)("reports %s recovery within one minute", async (name) => {
    checks[name].mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    expect((await GET()).status).toBe(500);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await GET()).status).toBe(500);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await GET()).status).toBe(200);
    expect(checks[name]).toHaveBeenCalledTimes(2);
  });

  it("does not start a second check while a timed-out one is still running", async () => {
    let finish: (value: boolean) => void = () => {};
    checks.redis.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await (await pending).json()).fuses.redis).toMatchObject({ code: "HEALTH_CHECK_TIMEOUT" });

    await vi.advanceTimersByTimeAsync(60_000);
    const stillRunning = await GET();
    expect(stillRunning.status).toBe(500);
    expect((await stillRunning.json()).fuses.redis).toMatchObject({ status: "unavailable", code: "HEALTH_CHECK_STILL_RUNNING" });
    expect(checks.redis).toHaveBeenCalledOnce();

    finish(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await GET()).status).toBe(200);
    expect(checks.redis).toHaveBeenCalledTimes(2);
  });

  it("shares one refresh between concurrent requests once a cached result expires", async () => {
    await GET();
    await vi.advanceTimersByTimeAsync(60_000);
    checks.postgres.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 200)));
    const pending = Promise.all(Array.from({ length: 10 }, () => GET()));
    await vi.advanceTimersByTimeAsync(200);
    for (const response of await pending) expect(response.status).toBe(200);
    expect(checks.postgres).toHaveBeenCalledTimes(2);
  });

  // Simulates a store that hands back an expired success, e.g. after a wall-clock jump.
  const stubSignal = (name: string, success: { success: boolean; durationMs: number; checkedAt?: string }) =>
    vi.stubGlobal("ventryHealthSignals", new Map([[name, {
      success, successAt: performance.now(), successStartedAt: performance.now(), failureAt: -Infinity,
    }]]));

  it("reports a success older than its freshness limit as stale", async () => {
    stubSignal("giphy", { success: true, durationMs: 0, checkedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.status).toBe("degraded");
    expect(body.fuses.giphy).toMatchObject({ success: true, status: "stale" });
  });

  it("reports a success without a check time as stale", async () => {
    stubSignal("giphy", { success: true, durationMs: 0 });
    expect((await (await GET()).json()).fuses.giphy.status).toBe("stale");
  });

  it("reports a stale observed SQL success as an error", async () => {
    stubSignal("prisma", { success: true, durationMs: 0, checkedAt: new Date(Date.now() - 61 * 60_000).toISOString() });
    const body = await (await GET()).json();
    expect(body.status).toBe("error");
    expect(body.fuses.prisma.status).toBe("stale");
  });

  describe("passive Prisma query signals", () => {
    let recordHealthSignal: typeof import("@/lib/health-signals").recordHealthSignal;
    const outage = { success: false, durationMs: 3, error: "Database query failed", code: "P1001" };
    const query = { success: true, durationMs: 4 };

    beforeEach(async () => {
      ({ recordHealthSignal } = await import("@/lib/health-signals"));
    });

    it("uses a recent real query instead of SELECT 1", async () => {
      recordHealthSignal("prisma", query);
      const response = await GET();
      expect(response.status).toBe(200);
      expect((await response.json()).fuses.prisma).toMatchObject({ status: "healthy", durationMs: 4 });
      expect(checks.prisma).not.toHaveBeenCalled();
    });

    it("keeps skipping SELECT 1 while real queries keep succeeding", async () => {
      for (let minute = 0; minute < 180; minute++) {
        recordHealthSignal("prisma", query);
        expect((await GET()).status).toBe(200);
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(checks.prisma).not.toHaveBeenCalled();
    });

    it("falls back to the hourly SELECT 1 once real queries stop", async () => {
      recordHealthSignal("prisma", query);
      await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
      await GET();
      expect(checks.prisma).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await GET();
      expect(checks.prisma).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      await GET();
      expect(checks.prisma).toHaveBeenCalledOnce();
    });

    it("reports a real query outage immediately, even right after a successful probe", async () => {
      expect((await GET()).status).toBe(200);
      recordHealthSignal("prisma", outage);
      const response = await GET();
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.status).toBe("error");
      expect(body.fuses.prisma).toMatchObject({ status: "unavailable", code: "P1001", error: "Database query failed" });
      expect(checks.prisma).toHaveBeenCalledOnce();
    });

    it("recovers from a query that started after the failure, without a probe", async () => {
      recordHealthSignal("prisma", outage);
      await vi.advanceTimersByTimeAsync(5_000);
      recordHealthSignal("prisma", query);
      expect((await GET()).status).toBe(200);
      expect(checks.prisma).not.toHaveBeenCalled();
    });

    it("does not let a slow query that started before the failure hide it", async () => {
      const slowStartedAt = performance.now();
      await vi.advanceTimersByTimeAsync(1_000);
      recordHealthSignal("prisma", outage);
      await vi.advanceTimersByTimeAsync(1_000);
      recordHealthSignal("prisma", query, slowStartedAt);
      const body = await (await GET()).json();
      expect(body.fuses.prisma).toMatchObject({ status: "unavailable", code: "P1001" });
    });

    it("probes for recovery once a failure is a minute old and nothing else arrived", async () => {
      recordHealthSignal("prisma", outage);
      await vi.advanceTimersByTimeAsync(59_999);
      expect((await GET()).status).toBe(500);
      expect(checks.prisma).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await GET()).status).toBe(200);
      expect(checks.prisma).toHaveBeenCalledOnce();
    });

    it("keeps reporting a failed recovery probe", async () => {
      recordHealthSignal("prisma", outage);
      checks.prisma.mockRejectedValue(Object.assign(new Error("down"), { code: "P1001" }));
      await vi.advanceTimersByTimeAsync(60_000);
      const body = await (await GET()).json();
      expect(body.fuses.prisma).toMatchObject({ status: "unavailable", code: "P1001" });
      expect(checks.prisma).toHaveBeenCalledOnce();
    });

    it("shares one fallback probe between concurrent requests", async () => {
      checks.prisma.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 200)));
      const pending = Promise.all(Array.from({ length: 10 }, () => GET()));
      await vi.advanceTimersByTimeAsync(200);
      for (const response of await pending) expect(response.status).toBe(200);
      expect(checks.prisma).toHaveBeenCalledOnce();
    });
  });

  it("reports pg_isready failures as a database error", async () => {
    checks.postgres.mockRejectedValue(Object.assign(new Error("pg_isready failed"), { code: "PG_ISREADY_NO_RESPONSE" }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.fuses.postgres).toMatchObject({ status: "unavailable", code: "PG_ISREADY_NO_RESPONSE" });
  });
});
