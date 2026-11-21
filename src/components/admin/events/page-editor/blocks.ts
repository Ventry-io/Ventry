import type { LeafBlock, PageBlock } from "@/types/schemas/event/page";

export const BLOCK_LABELS: Record<PageBlock["type"], string> = {
  heading: "Heading", text: "Text", image: "Image", gallery: "Gallery", button: "Button", link: "Link (text, icon or image)",
  linkMenu: "Dropdown with links", accordion: "FAQ / accordion", divider: "Divider", spacer: "Spacing",
  telegram: "Telegram channel", section: "Section with columns",
  about: "Event description", location: "Location & map", attendees: "Attendee list",
};

export const LEAF_TYPES = Object.keys(BLOCK_LABELS).filter(type => type !== "section") as LeafBlock["type"][];

export const newId = () => crypto.randomUUID().slice(0, 8);

export function createBlock(type: PageBlock["type"], homeSlug: string): PageBlock {
  const id = newId();
  switch (type) {
    case "heading": return { id, type, text: "New heading", level: 2, align: "left" };
    case "text": return { id, type, title: "", text: "" };
    case "image": return { id, type, url: "", alt: "" } as unknown as PageBlock; // filled by upload or URL field
    case "gallery": return { id, type, images: [], columns: 3 } as unknown as PageBlock;
    case "button": return { id, type, label: "Learn more", target: { page: homeSlug }, variant: "contained" };
    case "link": return { id, type, display: "text", label: "Visit our website", target: { url: "https://" }, icon: "website", align: "left" };
    case "linkMenu": return { id, type, label: "Links", links: [{ id: newId(), label: "Link", target: { page: homeSlug } }] };
    case "accordion": return { id, type, items: [{ id: newId(), title: "Question", text: "Answer" }] };
    case "divider": return { id, type };
    case "spacer": return { id, type, size: "md" };
    case "telegram": return { id, type, channel: "", limit: 5, pinned: [] } as unknown as PageBlock;
    case "section": return { id, type, columns: [[], []], padding: "md" };
    default: return { id, type };
  }
}
