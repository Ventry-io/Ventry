import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PageDesigner from "./PageDesigner";
import { normalizeEventPage } from "@/types/schemas/event/page";

const event = { id: 42, name: "Paws Con", description: "A con", imageUrl: null, location: null };
afterEach(() => vi.unstubAllGlobals());

describe("PageDesigner", () => {
  it("saves drafts separately and publishes only after confirmation", async () => {
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) =>
      Response.json(init.method === "POST" ? { publishedAt: "2026-11-21T12:00:00.000Z" } : { message: "ok" }));
    vi.stubGlobal("fetch", fetch);
    render(<PageDesigner published={normalizeEventPage({})} draft={null} publishedAt={null} event={event} assetHost="cdn.example" canWrite />);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Use template" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Replace design" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/event/42/page-design", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(fetch.mock.calls[0][1].body).design.pages.map((page: { slug: string }) => page.slug)).toEqual(["home", "program", "venue", "travel", "faq"]);
    expect(await screen.findByText("Draft saved, not published yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish your event page?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Publish your event page?" })).getByRole("button", { name: "Publish now" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/admin/event/42/page-design", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(/Your page is live!/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Published, matches the live page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View live page" })).toHaveAttribute("href", "/events/42");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("opens an existing draft and can discard it back to the live page", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ message: "ok" }));
    vi.stubGlobal("fetch", fetch);
    const draft = normalizeEventPage({ version: 2, nav: [], pages: [{ id: "home", slug: "home", title: "Draft home", blocks: [] }] });
    render(<PageDesigner published={normalizeEventPage({})} draft={draft} publishedAt="2026-11-01T10:00:00.000Z" event={event} assetHost={null} canWrite />);
    expect(screen.getByText("Draft saved, not published yet")).toBeInTheDocument();
    expect(screen.getByText(/^Last published/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Discard your draft?" })).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/event/42/page-design", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Published, matches the live page")).toBeInTheDocument();
  });

  it("blocks saving while the design is invalid", () => {
    render(<PageDesigner published={normalizeEventPage({})} draft={null} publishedAt={null} event={event} assetHost={null} canWrite />);
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "#fefefe" } });
    expect(screen.getByText(/Fix these before saving/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("allows hyphens in page addresses while typing", () => {
    render(<PageDesigner published={normalizeEventPage({})} draft={null} publishedAt={null} event={event} assetHost={null} canWrite />);
    fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    const address = screen.getAllByLabelText("Address")[1];
    for (const value of ["about", "about-", "about-us"]) fireEvent.change(address, { target: { value } });
    expect(address).toHaveValue("about-us");
    fireEvent.change(address, { target: { value: "Über uns-" } });
    expect(address).toHaveValue("uber-uns-");
    fireEvent.blur(address);
    expect(address).toHaveValue("uber-uns");
  });

  it("adds a page and lets menu links target it", () => {
    render(<PageDesigner published={normalizeEventPage({})} draft={null} publishedAt={null} event={event} assetHost={null} canWrite />);
    fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    fireEvent.click(screen.getByRole("tab", { name: "Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Add menu entry" }));
    fireEvent.mouseDown(screen.getByLabelText("Link to"));
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "Page: New page" })).toBeInTheDocument();
  });

  it("is read-only without write access", () => {
    render(<PageDesigner published={normalizeEventPage({})} draft={null} publishedAt={null} event={event} assetHost={null} canWrite={false} />);
    expect(screen.getByText("You have read-only access to this event.")).toBeInTheDocument();
  });
});
