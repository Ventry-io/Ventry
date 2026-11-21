import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EventSiteNav from "./EventSiteNav";
import PageBlocks, { type SiteContext } from "./PageBlocks";
import { EventSiteFrame, EventSiteStyles } from "./EventSiteFrame";
import PagePreview from "@/components/admin/events/page-editor/PagePreview";
import { buildSiteCss } from "@/lib/events/page-css";
import { EventPageSchema, normalizeEventPage, type NavItem, type PageBlock } from "@/types/schemas/event/page";

const ctx: SiteContext = { eventId: 42, homeSlug: "home", telegramSource: "public", telegram: {} };
const nav: NavItem[] = [
  { id: "a", label: "Artists", target: { page: "artists" }, children: [] },
  { id: "i", label: "Info", children: [{ id: "t", label: "Travel", target: { page: "travel" } }, { id: "s", label: "Shop", target: { url: "https://shop.example.com" } }] },
];

describe("EventSiteNav", () => {
  it("renders page links and opens dropdowns from the keyboard", async () => {
    render(<EventSiteNav nav={nav} ctx={ctx} currentHref="/events/42/p/artists" />);
    const desktop = screen.getAllByRole("navigation", { name: "Event pages" })[0];
    expect(within(desktop).getByRole("link", { name: "Artists" })).toHaveAttribute("aria-current", "page");
    const info = within(desktop).getByRole("button", { name: "Info" });
    expect(info).toHaveAttribute("aria-haspopup", "menu");
    info.focus();
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.click(info);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Travel" })).toHaveAttribute("href", "/events/42/p/travel");
    expect(within(menu).getByRole("menuitem", { name: "Shop" })).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("renders nothing without menu entries", () => {
    const { container } = render(<EventSiteNav nav={[]} ctx={ctx} currentHref="/events/42" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PageBlocks", () => {
  const blocks = [
    { id: "h", type: "heading", text: "Welcome", level: 2, align: "center" },
    { id: "s", type: "section", padding: "md", cssClass: "hero", columns: [[{ id: "b", type: "button", label: "Home", target: { page: "home" }, variant: "contained" }], [{ id: "f", type: "accordion", items: [{ id: "q", title: "Parking?", text: "Yes" }] }]] },
    { id: "g", type: "gallery", columns: 3, images: [{ url: "https://example.com/a.gif", posterUrl: "https://example.com/a.jpg", alt: "Badge art" }] },
    { id: "about", type: "about" },
  ] as PageBlock[];
  it("renders every element with styling classes, links and slots", () => {
    const { container } = render(<PageBlocks blocks={blocks} ctx={ctx} slots={{ about: <p>About slot</p> }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/events/42");
    expect(screen.getByText("Parking?").closest("details")).not.toBeNull();
    expect(screen.getByAltText("Badge art").closest("picture")?.querySelector("source")).toHaveAttribute("srcset", "https://example.com/a.jpg");
    expect(screen.getByText("About slot")).toBeInTheDocument();
    expect(container.querySelector(".vp-block.vp-block-section.hero")).not.toBeNull();
  });
});

describe("EventSiteFrame", () => {
  it("contains organizer styles inside a paint-contained root", () => {
    const design = normalizeEventPage({});
    const css = buildSiteCss({ customCss: ".x{position:fixed;color:red}", customFontUrl: "https://evil.example/f.woff2" }, "cdn.example").css;
    const { container } = render(<><EventSiteStyles css={css} /><EventSiteFrame theme={design.theme}><span className="x">x</span></EventSiteFrame></>);
    expect(container.querySelector(".vp-root")).toHaveStyle({ contain: "paint" });
    const style = container.querySelector("style")?.textContent || "";
    expect(style).toContain(".vp-root .x{color:red}");
    expect(style).not.toMatch(/fixed|evil\.example/);
  });
});

describe("PagePreview", () => {
  it("switches pages instead of leaving the editor when a link is clicked", () => {
    const design = normalizeEventPage({ version: 2, nav: [], pages: [
      { id: "home", slug: "home", title: "Home", blocks: [{ id: "b", type: "button", label: "To artists", target: { page: "artists" } }] },
      { id: "artists", slug: "artists", title: "Artists", blocks: [] },
    ] });
    const onNavigate = vi.fn();
    render(<PagePreview design={design} pageIndex={0} css="" mobile={false} onNavigate={onNavigate}
      event={{ id: 42, name: "Con", description: "", imageUrl: null, location: null }} />);
    const link = screen.getByRole("link", { name: "To artists" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});

describe("Link element and leave-site warning", () => {
  const link = (extra: object) => ({ id: "l", type: "link", label: "Our shop", target: { url: "https://shop.example.com/x" }, display: "text", icon: "shop", align: "left", ...extra }) as PageBlock;

  it("warns on every click before opening an external link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<PageBlocks blocks={[link({})]} ctx={ctx} />);
    const anchor = screen.getByRole("link", { name: "Our shop" });
    for (let i = 0; i < 2; i++) {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      anchor.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/You are leaving/)).toBeInTheDocument();
      expect(within(dialog).getByText("shop.example.com")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Stay here" })).toHaveFocus();
      fireEvent.click(within(dialog).getByRole("button", { name: i === 0 ? "Stay here" : "Open link" }));
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://shop.example.com/x", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("also warns on middle clicks and for buttons, dropdowns and menu links", async () => {
    render(<><PageBlocks blocks={[{ id: "b", type: "button", label: "Tickets elsewhere", target: { url: "https://evil.example" }, variant: "contained" } as PageBlock]} ctx={ctx} />
      <EventSiteNav nav={nav} ctx={ctx} currentHref="/events/42" /></>);
    const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    screen.getByRole("link", { name: "Tickets elsewhere" }).dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(await screen.findByText("evil.example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(screen.getAllByRole("navigation")[0]).getByRole("button", { name: "Info" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Shop" }));
    expect(await screen.findByText("shop.example.com")).toBeInTheDocument();
  });

  it("does not warn for links to the event's own pages", () => {
    render(<PageBlocks blocks={[link({ target: { page: "artists" }, label: "Artists" })]} ctx={ctx} />);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "Artists" }).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names icon and image links for screen readers", () => {
    render(<PageBlocks blocks={[link({ id: "i", display: "icon", label: "Instagram", icon: "instagram" }), link({ id: "m", display: "image", label: "Sponsor Paws Inc", imageUrl: "https://example.com/logo.png" })]} ctx={ctx} />);
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://shop.example.com/x");
    expect(screen.getByRole("link", { name: "Sponsor Paws Inc" }).querySelector("img")).toHaveAttribute("alt", "Sponsor Paws Inc");
  });

  it("asks before opening the email app", async () => {
    render(<PageBlocks blocks={[link({ label: "Mail us", target: { url: "mailto:team@example.com" } })]} ctx={ctx} />);
    fireEvent.click(screen.getByRole("link", { name: "Mail us" }));
    expect(await screen.findByText("Open your email app?")).toBeInTheDocument();
    expect(screen.getByText("team@example.com")).toBeInTheDocument();
  });

  it("validates link elements", () => {
    const pageWith = (block: object) => ({ version: 2, nav: [], pages: [{ id: "home", slug: "home", title: "Home", blocks: [block] }] });
    expect(EventPageSchema.safeParse(pageWith(link({}))).success).toBe(true);
    expect(EventPageSchema.safeParse(pageWith(link({ display: "image" }))).success).toBe(false);
    expect(EventPageSchema.safeParse(pageWith(link({ target: { url: "javascript:alert(1)" } }))).success).toBe(false);
    expect(EventPageSchema.safeParse(pageWith(link({ label: "" }))).success).toBe(false);
  });
});
