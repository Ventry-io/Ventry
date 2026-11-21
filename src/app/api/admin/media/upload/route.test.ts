import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sharpMocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: sharpMocks.sharp,
}));

vi.mock("@/lib/auth/admin", () => ({
  checkAdminAuth: vi.fn(),
  forbiddenResponse: vi.fn((error?: string) =>
    new Response(JSON.stringify({ error: error ?? "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  ),
}));

vi.mock("@/lib/supabase", async () => ({
  ...await vi.importActual<object>("@/lib/supabase"),
  uploadEventImage: vi.fn(),
  getSignedUrl: vi.fn(),
}));

const eventAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/event-admin", () => ({ checkEventAdminAuth: eventAccess }));

function installSharpMock() {
  sharpMocks.sharp.mockImplementation(() => {
    const pipeline = {
      rotate: vi.fn(() => pipeline),
      resize: vi.fn(() => pipeline),
      jpeg: vi.fn(() => pipeline),
      toBuffer: sharpMocks.toBuffer,
    };

    return pipeline;
  });
}

import * as mediaRoute from "@/app/api/admin/media/upload/route";
import { checkAdminAuth } from "@/lib/auth/admin";
import { getSignedUrl, uploadEventImage } from "@/lib/supabase";

const mockedCheckAdminAuth = checkAdminAuth as unknown as ReturnType<typeof vi.fn>;
const mockedUploadEventImage = uploadEventImage as unknown as ReturnType<typeof vi.fn>;
const mockedGetSignedUrl = getSignedUrl as unknown as ReturnType<typeof vi.fn>;

describe("App Router: /api/admin/media/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpMocks.toBuffer.mockResolvedValue(Buffer.from("optimized-banner"));
    installSharpMock();
    mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-1" });
    eventAccess.mockResolvedValue({ authorized: true });
    mockedUploadEventImage.mockResolvedValue({ path: "events/event-new.jpg" });
    mockedGetSignedUrl.mockResolvedValue({
      signedUrl: "https://cdn.example.com/event-new",
      expiresIn: 365 * 24 * 60 * 60,
    });
  });

  function post(fields: Record<string, string>) {
    const file = { size: 1024, arrayBuffer: vi.fn().mockResolvedValue(Buffer.from("raw")) } as unknown as File;
    return mediaRoute.POST({
      headers: new Headers(),
      formData: vi.fn().mockResolvedValue({ get: vi.fn((key: string) => key === "file" ? file : fields[key] ?? null) }),
    } as unknown as NextRequest);
  }

  it("keeps banners uploaded before the event exists in the admin's drafts folder", async () => {
    const response = await post({ mode: "banner" });

    expect(response.status).toBe(200);
    expect(eventAccess).not.toHaveBeenCalled();
    expect(mockedUploadEventImage).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/^drafts\/admin-1\/banner\/[\w-]+\.jpg$/), "banners");
    expect(mockedGetSignedUrl).toHaveBeenCalledWith("events/event-new.jpg", 10 * 365 * 24 * 60 * 60, "banners");
  });

  it("stores event media in the event's folders after checking write access", async () => {
    expect((await post({ mode: "banner", eventId: "7" })).status).toBe(200);
    expect((await post({ mode: "badge-background", eventId: "7" })).status).toBe(200);
    expect((await post({ mode: "badge-photo", eventId: "7" })).status).toBe(200);

    expect(eventAccess).toHaveBeenCalledWith(7, expect.any(Headers), undefined, true);
    expect(mockedUploadEventImage.mock.calls.map(call => [call[1].replace(/[\w-]+\.jpg$/, "*"), call[2]])).toEqual([
      ["events/7/banner/*", "banners"],
      ["events/7/badges/*", "banners"],
      ["events/7/badge-photos/*", "profile"],
    ]);
  });

  it("rejects invalid or foreign events before storing anything", async () => {
    expect((await post({ eventId: "../1" })).status).toBe(400);
    eventAccess.mockResolvedValue({ authorized: false, error: "Forbidden" });
    expect((await post({ eventId: "8" })).status).toBe(403);
    expect(mockedUploadEventImage).not.toHaveBeenCalled();
  });
});
