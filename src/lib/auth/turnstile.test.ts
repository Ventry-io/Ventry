import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const headers = new Headers({ "x-captcha-response": "widget-token" });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
  vi.stubEnv("TURNSTILE_HOSTNAMES", "local.dev");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Turnstile verification", () => {
  it("disables protection only when both keys are absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(await verifyTurnstile(headers)).toBe(false);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyTurnstile()).toBe(true);
  });
  it("rejects missing or oversized tokens without a network call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await verifyTurnstile()).toBe(false);
    expect(await verifyTurnstile(new Headers({ "x-captcha-response": "x".repeat(2049) }))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("verifies the token server-side", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, action: "authenticate", hostname: "local.dev" }));
    vi.stubGlobal("fetch", fetch);
    expect(await verifyTurnstile(headers)).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ secret: "secret", response: "widget-token" });
  });
  it.each([
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, action: "other", hostname: "local.dev" },
    { success: true, action: "authenticate", hostname: "untrusted.example" },
    { success: true },
  ])("rejects invalid, expired, reused or mismatched responses: %j", async result => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result)));
    expect(await verifyTurnstile(headers)).toBe(false);
  });
  it("fails closed on timeout, HTTP errors and malformed provider responses", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true, action: "authenticate", hostname: "local.dev" }, { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) expect(await verifyTurnstile(headers)).toBe(false);
  });
});
