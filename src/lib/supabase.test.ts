// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory storage: bucket -> object paths.
const store = vi.hoisted(() => new Map<string, Set<string>>());
const removed = vi.hoisted(() => [] as { bucket: string; paths: string[] }[]);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        // Mirrors Supabase: one level per call, folders have id null.
        list: async (folder: string, { limit, offset }: { limit: number; offset: number }) => {
          const prefix = folder.replace(/\/$/, "");
          const entries = new Map<string, boolean>();
          for (const path of store.get(bucket) ?? []) {
            if (!path.startsWith(`${prefix}/`)) continue;
            const [name, ...rest] = path.slice(prefix.length + 1).split("/");
            entries.set(name, rest.length === 0 || entries.get(name) === true);
          }
          return { data: [...entries].slice(offset, offset + limit).map(([name, file]) => ({ name, id: file ? name : null })), error: null };
        },
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

import { deleteEventMedia, storageObjectFromUrl } from "./supabase";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("SUPABASE_BUCKET_ID", "Ventry Profile Pictures");
  vi.stubEnv("SUPABASE_BANNERS_BUCKET_ID", "banners");
  store.clear();
  removed.length = 0;
});

describe("deleteEventMedia", () => {
  it("removes the event's folders, community images and draft banner, and nothing of other events", async () => {
    store.set("banners", new Set([
      "events/7/banner/a.jpg", "events/7/page/b.gif", "events/7/page/b-poster.jpg", "events/7/fonts/c.woff2",
      "events/70/page/other.jpg", "events/legacy-flat.jpg", "drafts/admin-1/banner/d.jpg", "drafts/admin-1/banner/keep.jpg",
    ]));
    store.set("Ventry Profile Pictures", new Set(["events/7/badge-photos/e.jpg", "community/7/user-1/f.jpg", "community/70/user-1/g.jpg", "users/user-1/h.jpg"]));

    const count = await deleteEventMedia(7, "https://abc.supabase.co/storage/v1/object/sign/banners/drafts/admin-1/banner/d.jpg?token=x");

    expect(count).toBe(7);
    expect(removed.find(call => call.bucket === "banners")?.paths.sort()).toEqual([
      "drafts/admin-1/banner/d.jpg", "events/7/banner/a.jpg", "events/7/fonts/c.woff2", "events/7/page/b-poster.jpg", "events/7/page/b.gif",
    ]);
    expect(removed.find(call => call.bucket === "Ventry Profile Pictures")?.paths.sort()).toEqual(["community/7/user-1/f.jpg", "events/7/badge-photos/e.jpg"]);
  });

  it("does nothing for events without files and never deletes banners outside drafts", async () => {
    store.set("banners", new Set(["events/legacy.jpg"]));
    expect(await deleteEventMedia(8, "https://abc.supabase.co/storage/v1/object/sign/banners/events/legacy.jpg?token=x")).toBe(0);
    expect(await deleteEventMedia(8, "https://evil.example/storage/v1/object/sign/banners/drafts/a/banner/x.jpg")).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe("storageObjectFromUrl", () => {
  it("parses signed and public URLs of this project only", () => {
    expect(storageObjectFromUrl("https://abc.supabase.co/storage/v1/object/sign/Ventry%20Profile%20Pictures/users/u/p.jpg?token=1"))
      .toEqual({ bucket: "Ventry Profile Pictures", path: "users/u/p.jpg" });
    expect(storageObjectFromUrl("https://abc.supabase.co/storage/v1/object/public/banners/events/1/page/x.jpg")).toEqual({ bucket: "banners", path: "events/1/page/x.jpg" });
    expect(storageObjectFromUrl("https://other.supabase.co/storage/v1/object/sign/banners/x.jpg")).toBeNull();
    expect(storageObjectFromUrl("not a url")).toBeNull();
  });
});
