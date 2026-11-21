// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), viewer: vi.fn(), posts: vi.fn() }));
vi.mock("@/lib/prisma/prisma", () => ({ prisma: { event: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/events/public-event", () => ({ getEventViewer: mocks.viewer, visibleEventWhere: (id: number) => ({ id, visible: true }) }));
vi.mock("@/lib/events/telegram", async importOriginal => ({ ...(await importOriginal<object>()), getChannelPosts: mocks.posts }));
import { GET } from "./route";

const design = { version: 2, nav: [], pages: [{ id: "home", slug: "home", title: "Home", blocks: [
  { id: "news", type: "telegram", channel: "con_news" },
  { id: "s", type: "section", columns: [[{ id: "nested", type: "telegram", channel: "con_artists" }]] },
  { id: "intro", type: "text", title: "", text: "Hi" },
] }] };
const get = (query: string, id = "7") => GET(new NextRequest(`https://local.dev:3443/api/event/${id}/telegram?${query}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ admin: null, orgIds: [] });
  mocks.findFirst.mockResolvedValue({ pageDesign: design });
  mocks.posts.mockResolvedValue({ posts: [3, 2], nextBefore: 2 });
});

describe("GET /api/event/[id]/telegram", () => {
  it("loads the channel stored in the page design, including section children", async () => {
    expect(await (await get("block=news&before=10")).json()).toEqual({ posts: [3, 2], nextBefore: 2 });
    expect(mocks.posts).toHaveBeenCalledWith("con_news", 10);
    await get("block=nested");
    expect(mocks.posts).toHaveBeenLastCalledWith("con_artists", undefined);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 7, visible: true }, select: { pageDesign: true } });
  });
  it("ignores a channel passed in the query", async () => {
    await get("block=news&channel=evil_channel");
    expect(mocks.posts).toHaveBeenCalledWith("con_news", undefined);
  });
  it.each(["block=intro", "block=missing"])("returns 404 for non-Telegram blocks: %s", async query => {
    expect((await get(query)).status).toBe(404);
    expect(mocks.posts).not.toHaveBeenCalled();
  });
  it("returns 404 for events the visitor cannot see, such as drafts", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await get("block=news")).status).toBe(404);
  });
  it.each(["", "block=news&before=abc", "block=news&before=1"])("rejects invalid input: %s", async query => {
    expect((await get(query)).status).toBe(400);
  });
  it("returns 502 when Telegram fails", async () => {
    mocks.posts.mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("block=news")).status).toBe(502);
  });
});
