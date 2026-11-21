import { EventPageSchema, type EventPage } from "@/types/schemas/event/page";

export type PageTemplate = { id: string; name: string; description: string; design: EventPage };

const text = (id: string, title: string, body: string) => ({ id, type: "text" as const, title, text: body });
const heading = (id: string, value: string, align: "left" | "center" = "left") => ({ id, type: "heading" as const, text: value, level: 2 as const, align });

const raw = [
  {
    id: "classic", name: "Classic", description: "The standard Ventry layout: description, location and attendees.",
    design: { theme: {}, nav: [], pages: [{ id: "home", slug: "home", title: "Home", blocks: [{ id: "about", type: "about" }, { id: "location", type: "location" }, { id: "attendees", type: "attendees" }] }] },
  },
  {
    id: "convention", name: "Convention", description: "Menu with programme, venue, travel and FAQ pages for multi-day cons.",
    design: {
      theme: { font: "geometric", background: "#1b1035", foreground: "#f4f0ff", accent: "#ffb84d" },
      nav: [
        { id: "nav-home", label: "Home", target: { page: "home" } },
        { id: "nav-program", label: "Programme", target: { page: "program" } },
        { id: "nav-venue", label: "Venue", target: { page: "venue" } },
        { id: "nav-info", label: "Info", children: [
          { id: "nav-travel", label: "Travel", target: { page: "travel" } },
          { id: "nav-faq", label: "FAQ", target: { page: "faq" } },
        ] },
      ],
      pages: [
        { id: "home", slug: "home", title: "Home", blocks: [
          heading("welcome", "Welcome to the con!", "center"), { id: "about", type: "about" },
          { id: "home-links", type: "section", columns: [
            [heading("h-program", "Programme"), text("t-program", "", "Panels, workshops and the evening show."), { id: "b-program", type: "button", label: "See programme", target: { page: "program" } }],
            [heading("h-venue", "Venue"), text("t-venue", "", "Rooms, accessibility and house rules."), { id: "b-venue", type: "button", label: "Explore the venue", target: { page: "venue" } }],
          ] },
          { id: "attendees", type: "attendees" },
        ] },
        { id: "program", slug: "program", title: "Programme", blocks: [heading("program-title", "Programme"), text("program-text", "", "Add your programme here. The detailed timetable is in the Schedule tab on the home page.")] },
        { id: "venue", slug: "venue", title: "Venue", blocks: [heading("venue-title", "Venue"), { id: "location", type: "location" }, { id: "venue-grid", type: "section", columns: [
          [heading("v1", "Rooms"), text("v1-text", "", "Main stage, dealers' den, art show and quiet room.")],
          [heading("v2", "Accessibility"), text("v2-text", "", "Step-free access, lifts and seating areas.")],
          [heading("v3", "House rules"), text("v3-text", "", "Opening hours, photo rules and what you can bring.")],
        ] }] },
        { id: "travel", slug: "travel", title: "Travel", blocks: [text("travel-text", "Getting there", "Public transport, parking and accessibility information.")] },
        { id: "faq", slug: "faq", title: "FAQ", blocks: [heading("faq-title", "Frequently asked questions"), { id: "faq-list", type: "accordion", items: [
          { id: "q1", title: "When does check-in open?", text: "Check-in opens one hour before the first programme item." },
          { id: "q2", title: "Can I bring my partial or fursuit?", text: "Yes. A changing room and headless lounge are available." },
          { id: "q3", title: "Is the venue accessible?", text: "Describe step-free access, lifts and quiet rooms here." },
        ] }] },
      ],
    },
  },
  {
    id: "artist-showcase", name: "Artist showcase", description: "Dark, image-first layout with a gallery page and custom CSS to build on.",
    design: {
      theme: {
        font: "humanist", background: "#111111", foreground: "#f5f5f5", accent: "#ff6ec7",
        customCss: ".vp-block-heading h2 { letter-spacing: 0.08em; text-transform: uppercase; }\n.vp-block-section { box-shadow: 0 0 0 1px #ff6ec7; }",
      },
      nav: [{ id: "nav-home", label: "Home", target: { page: "home" } }, { id: "nav-gallery", label: "Gallery", target: { page: "gallery" } }],
      pages: [
        { id: "home", slug: "home", title: "Home", blocks: [
          { id: "intro", type: "section", background: "#1e1e1e", padding: "lg", columns: [[heading("intro-title", "About the show"), { id: "about", type: "about" }]] },
          { id: "location", type: "location" },
        ] },
        { id: "gallery", slug: "gallery", title: "Gallery", blocks: [heading("gallery-title", "Gallery"), text("gallery-hint", "", "Add a gallery element and upload your artwork. Animated GIFs get a still image for visitors who reduce motion.")] },
      ],
    },
  },
  {
    id: "walk", name: "Minimal walk", description: "One calm page for walks and meetups without tickets.",
    design: {
      theme: { font: "rounded", background: "#f3f7f0", foreground: "#1f2d1f", accent: "#2e6b30" },
      nav: [],
      pages: [{ id: "home", slug: "home", title: "Home", blocks: [
        { id: "about", type: "about" }, { id: "location", type: "location" },
        text("bring", "What to bring", "Water, weather-appropriate clothes and good shoes."),
      ] }],
    },
  },
];

export const PAGE_TEMPLATES: PageTemplate[] = raw.map(template => ({ ...template, design: EventPageSchema.parse(template.design) }));

/** Applies a template's pages, menu and theme; keeps the organizer's uploaded header and font. */
export function applyTemplate(current: EventPage, template: PageTemplate): EventPage {
  const { headerUrl, headerPosterUrl, customFontUrl, backgroundImage } = current.theme;
  return structuredClone({ ...template.design, theme: { ...template.design.theme, headerUrl, headerPosterUrl, customFontUrl, backgroundImage } });
}
