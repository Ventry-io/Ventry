// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ access: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ forbiddenResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }) }));
vi.mock("@/lib/auth/event-admin", () => ({ checkEventAdminAuth: mocks.access }));
vi.mock("@/lib/prisma/prisma", () => ({ prisma: { event: { update: mocks.update } } }));
import { Prisma } from "@/generated/prisma";
import { DELETE, POST, PUT } from "./route";

const design = { version: 2, nav: [], pages: [{ id: "home", slug: "home", title: "Home", blocks: [{ id: "h", type: "heading", text: "Hi", level: 2, align: "left" }] }] };
const call = (handler: (req: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>, body?: unknown, id = "7") => handler(
  new NextRequest(`https://local.dev:3443/api/admin/event/${id}/page-design`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ authorized: true });
  mocks.update.mockResolvedValue({ pageDesignPublishedAt: new Date("2026-11-21T12:00:00Z") });
});

describe("/api/admin/event/[id]/page-design", () => {
  it("requires write access for every action", async () => {
    mocks.access.mockResolvedValue({ authorized: false });
    for (const handler of [PUT, POST, DELETE]) expect((await call(handler, { design })).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(7, expect.any(Headers), undefined, true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves a draft without touching the published design", async () => {
    expect((await call(PUT, { design })).status).toBe(200);
    const { data } = mocks.update.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(["pageDesignDraft"]);
    expect(data.pageDesignDraft.pages[0].slug).toBe("home");
  });

  it("publishes the design, clears the draft and records the time", async () => {
    const response = await call(POST, { design });
    expect(await response.json()).toEqual({ publishedAt: "2026-11-21T12:00:00.000Z" });
    const { data } = mocks.update.mock.calls[0][0];
    expect(data.pageDesign.pages[0].blocks[0].text).toBe("Hi");
    expect(data.pageDesignDraft).toBe(Prisma.DbNull);
    expect(data.pageDesignPublishedAt).toBeInstanceOf(Date);
  });

  it("discards the draft", async () => {
    expect((await call(DELETE)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { pageDesignDraft: Prisma.DbNull } });
  });

  it("rejects invalid designs and ids before writing", async () => {
    const broken = { ...design, pages: [{ ...design.pages[0], slug: "Not A Slug" }] };
    expect((await call(PUT, { design: broken })).status).toBe(422);
    expect((await call(POST, { design, extra: true })).status).toBe(422);
    expect((await call(POST, null)).status).toBe(422);
    expect((await call(PUT, { design }, "abc")).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
