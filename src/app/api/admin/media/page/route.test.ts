// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), access: vi.fn(), upload: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ checkAdminAuth: mocks.admin, forbiddenResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }) }));
vi.mock("@/lib/auth/event-admin", () => ({ checkEventAdminAuth: mocks.access }));
vi.mock("@/lib/supabase", () => ({ uploadEventImage: mocks.upload, getSignedUrl: mocks.sign }));
import { POST } from "./route";

function request(file: Blob, eventId?: string) {
  const form = new FormData();
  form.set("file", file, "image.gif");
  if (eventId) form.set("eventId", eventId);
  return new NextRequest("https://local.dev:3443/api/admin/media/page", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ authorized: true });
  mocks.access.mockResolvedValue({ authorized: true });
  mocks.upload.mockImplementation(async (_buffer, filename) => ({ path: filename }));
  mocks.sign.mockImplementation(async path => ({ signedUrl: `https://example.com/${path}` }));
});

describe("event page image uploads", () => {
  it("preserves an animated GIF and creates a still JPEG for reduced motion", async () => {
    const header = "47494638396101000100800000000000ffffff";
    const frame = "21f904000a0000002c0000000001000100000202440100";
    const gif = Buffer.from(header + frame + frame.replace("024401", "024c01") + "3b", "hex");
    const response = await POST(request(new Blob([gif], { type: "image/gif" }), "42"));
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(42, expect.any(Headers), undefined, true);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect((await sharp(mocks.upload.mock.calls[0][0], { animated: true }).metadata()).pages).toBe(2);
    expect((await sharp(mocks.upload.mock.calls[1][0]).metadata()).format).toBe("jpeg");
    expect(mocks.upload.mock.calls[0].slice(2)).toEqual(["banners", "image/gif"]);
    expect(await response.json()).toMatchObject({ url: expect.stringMatching(/\.gif$/), posterUrl: expect.stringMatching(/-poster\.jpg$/) });
  });
  it("rejects SVG, invalid bytes and oversized uploads before storage", async () => {
    for (const file of [new Blob(["<svg></svg>"], { type: "image/svg+xml" }), new Blob(["not an image"]), new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])]) {
      expect((await POST(request(file))).status).toBeGreaterThanOrEqual(400);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects unauthorized event uploads", async () => {
    mocks.access.mockResolvedValue({ authorized: false });
    expect((await POST(request(new Blob(["image"]), "43"))).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("returns a retryable error when storage fails", async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    mocks.upload.mockRejectedValueOnce(new Error("Storage unavailable"));
    expect((await POST(request(new Blob([image])))).status).toBe(500);
  });
});
