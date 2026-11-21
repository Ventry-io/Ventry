import { afterEach, describe, expect, it, vi } from "vitest";
import { getChannelPosts, TelegramPreviewError } from "./telegram";

const page = (ids: number[], channel = "con_news") =>
  `<div class="tgme_channel_info"></div>${ids.map(id => `<div class="tgme_widget_message" data-post="${channel}/${id}"></div>`).join("")}<div data-post="other_chan/999"></div>`;
afterEach(() => vi.unstubAllGlobals());

describe("getChannelPosts", () => {
  it("returns newest posts first, ignores other channels and pages backwards", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(page([40, 42, 41, 42])));
    vi.stubGlobal("fetch", fetch);
    expect(await getChannelPosts("con_news")).toEqual({ posts: [42, 41, 40], nextBefore: 40 });
    await getChannelPosts("con_news", 40);
    expect(fetch.mock.calls[1][0]).toBe("https://t.me/s/con_news?before=40");
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", next: { revalidate: 300 } });
  });
  it("matches the channel name case-insensitively", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page([7], "Con_News"))));
    expect((await getChannelPosts("con_news")).posts).toEqual([7]);
  });
  it("stops paging at the first post", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page([1, 2]))));
    expect((await getChannelPosts("con_news")).nextBefore).toBeNull();
  });
  it.each([
    ["redirect for private or missing channels", new Response(null, { status: 302, headers: { location: "https://t.me/con_news" } })],
    ["server error", new Response("", { status: 500 })],
    ["page without channel preview", new Response("<html></html>")],
  ])("rejects %s", async (_name, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getChannelPosts("con_news")).rejects.toBeInstanceOf(TelegramPreviewError);
  });
  it("never requests invalid channel names or positions", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const channel of ["../admin", "a", "+invite", "evil.example/x"]) {
      await expect(getChannelPosts(channel)).rejects.toThrow("Invalid channel");
    }
    await expect(getChannelPosts("con_news", 0)).rejects.toThrow("Invalid position");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(getChannelPosts("con_news")).rejects.toThrow("timeout");
  });
});
