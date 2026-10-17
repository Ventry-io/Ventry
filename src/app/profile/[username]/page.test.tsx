import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ProfileViewPage from "./page";

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  event: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/user/profilePicture", () => ({ refreshSignedUrls: vi.fn(async () => []) }));
vi.mock("@/components/profile/PhotoGallery", () => ({ default: () => null }));

const PAST_EVENT = {
  id: 7, name: "Example Con", startDate: new Date("2020-10-17"),
  endDate: new Date("2020-10-20"), imageUrl: null, location: { city: "Berlin" },
};
const FUTURE_EVENT = {
  ...PAST_EVENT, id: 8, name: "Future Con", startDate: new Date("2099-11-01"), endDate: new Date("2099-11-04"),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.event.findMany.mockResolvedValue([PAST_EVENT]);
});

async function renderProfile(showConventions: boolean, overrides: Record<string, unknown> = {}) {
  prismaMock.user.findFirst.mockResolvedValue({
    id: "user-1", name: "Alice", username: "alice", showConventions, profilePictures: [],
    showAge: false, showExactBirthdate: false, pronouns: null, ...overrides,
  });
  const page = ProfileViewPage({ params: Promise.resolve({ username: "alice" }) });
  const content = page.props.children;
  render(await content.type(content.props));
}

describe("Public profile events", () => {
  it("does not fetch or show events or counts without consent", async () => {
    await renderProfile(false);
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Attended events" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upcoming events" })).not.toBeInTheDocument();
    expect(screen.queryByText("Example Con")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Attended/ })).not.toBeInTheDocument();
  });

  it("shows confirmed published events after consent, selecting only public details", async () => {
    await renderProfile(true);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        registrations: { some: { userId: "user-1", status: "CONFIRMED" } },
      },
      select: { id: true, name: true, startDate: true, endDate: true, imageUrl: true, location: { select: { city: true } } },
      orderBy: { startDate: "desc" },
    });
    expect(screen.getByRole("link", { name: /Example Con/ })).toHaveAttribute("href", "/events/7");
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 Attended" })).toHaveAttribute("href", "#attended-events");
  });

  it("separates past events from current and upcoming events, nearest first", async () => {
    const now = Date.now();
    prismaMock.event.findMany.mockResolvedValue([
      FUTURE_EVENT, PAST_EVENT,
      { ...PAST_EVENT, id: 9, name: "Current Con", startDate: new Date(now - 86400000), endDate: new Date(now + 86400000) },
    ]);
    await renderProfile(true);
    const upcoming = screen.getByRole("region", { name: "Upcoming events" });
    const attended = screen.getByRole("region", { name: "Attended events" });
    expect(within(attended).getByRole("link", { name: /Example Con/ })).toBeInTheDocument();
    expect(within(attended).queryByText("Current Con")).not.toBeInTheDocument();
    const links = within(upcoming).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Current Con");
    expect(links[1]).toHaveTextContent("Future Con");
    expect(within(upcoming).getByText("Happening now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2 Upcoming" })).toBeInTheDocument();
  });

  it("shows useful empty states when sharing is enabled without events", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    await renderProfile(true);
    expect(screen.getByText("No upcoming cons to share yet.")).toBeInTheDocument();
    expect(screen.getByText("No past cons to share yet.")).toBeInTheDocument();
    expect(screen.queryByText("Profile Information Coming Soon")).not.toBeInTheDocument();
  });

  it("keeps hidden age and birth date out of the public profile", async () => {
    await renderProfile(false, { dateOfBirth: new Date("2000-07-31"), showExactBirthdate: true });
    expect(screen.queryByText(/years old/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Born on/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("About this person")).not.toBeInTheDocument();
  });

  it("can show age without exposing the exact birth date", async () => {
    await renderProfile(false, { dateOfBirth: new Date("2000-07-31"), showAge: true });
    expect(screen.getByText(/Age: \d+ years old/)).toBeInTheDocument();
    expect(screen.queryByText(/Born on/)).not.toBeInTheDocument();
  });
});
