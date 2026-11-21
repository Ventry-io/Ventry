// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ access: vi.fn(), posts: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ forbiddenResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }) }));
vi.mock("@/lib/auth/event-admin", () => ({ checkEventAdminAuth: mocks.access }));
vi.mock("@/lib/events/telegram", async importOriginal => ({ ...(await importOriginal<object>()), getChannelPosts: mocks.posts }));
import { TelegramPreviewError } from "@/lib/events/telegram";
import { POST } from "./route";

const post = (body: unknown) => POST(new NextRequest("https://local.dev:3443/api/admin/event/7/telegram-check", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "7" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ authorized: true });
  mocks.posts.mockResolvedValue({ posts: [5], nextBefore: null });
});

describe("POST /api/admin/event/[id]/telegram-check", () => {
  it("requires write access to the event", async () => {
    mocks.access.mockResolvedValue({ authorized: false });
    expect((await post({ channel: "con_news" })).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(7, expect.any(Headers), undefined, true);
    expect(mocks.posts).not.toHaveBeenCalled();
  });
  it("previews a channel", async () => {
    expect(await (await post({ channel: "con_news", before: 9 })).json()).toEqual({ posts: [5], nextBefore: null });
    expect(mocks.posts).toHaveBeenCalledWith("con_news", 9);
  });
  it.each([{ channel: "https://t.me/x" }, { channel: "+invite" }, { channel: "con_news", url: "x" }, null])("rejects invalid input %j", async body => {
    expect((await post(body)).status).toBe(422);
    expect(mocks.posts).not.toHaveBeenCalled();
  });
  it("explains channels without a public preview", async () => {
    mocks.posts.mockRejectedValue(new TelegramPreviewError("This channel has no public web preview"));
    const response = await post({ channel: "private_chan" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "This channel has no public web preview" });
  });
});
