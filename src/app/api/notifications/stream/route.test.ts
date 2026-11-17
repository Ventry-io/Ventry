import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({ listener: null as null | (() => void), unsubscribe: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: session }));
vi.mock("@/lib/notifications-live", () => ({
  onNotification: vi.fn(async (_userId: string, listener: () => void) => {
    live.listener = listener;
    return live.unsubscribe;
  }),
}));
import { GET } from "@/app/api/notifications/stream/route";
import { onNotification } from "@/lib/notifications-live";

const decoder = new TextDecoder();

beforeEach(() => {
  vi.clearAllMocks();
  live.listener = null;
});

describe("GET /api/notifications/stream", () => {
  it("rejects anonymous requests", async () => {
    session.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://local.dev:3443/api/notifications/stream"))).status).toBe(401);
  });

  it("pushes an event per notification for the signed-in user and cleans up on disconnect", async () => {
    session.mockResolvedValue({ user: { id: "bob" } });
    const abort = new AbortController();
    const res = await GET(new NextRequest("https://local.dev:3443/api/notifications/stream", { signal: abort.signal }));
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    expect(decoder.decode((await reader.read()).value)).toContain(": connected");
    expect(onNotification).toHaveBeenCalledWith("bob", expect.any(Function));
    live.listener?.();
    expect(decoder.decode((await reader.read()).value)).toBe("event: notification\ndata: {}\n\n");

    abort.abort();
    expect(live.unsubscribe).toHaveBeenCalled();
  });
});
