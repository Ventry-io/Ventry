import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BadgeDesigner from "./BadgeDesigner";
import { DEFAULT_BADGE_TEMPLATE, type BadgeAttendee } from "@/lib/badges/badge";

vi.mock("@/components/profile/ImageCropper", () => ({ default: () => null }));

afterEach(cleanup);

it("previews conditional layers, switches background matches, and reorders design snapshots", () => {
  const template = {
    ...DEFAULT_BADGE_TEMPLATE,
    elements: [{ ...DEFAULT_BADGE_TEMPLATE.elements[1], type: "staticText" as const, staticText: "SPONSOR ACCESS",
      conditions: [{ field: "ticketTier", operator: "equals" as const, value: "Sponsor" }] }],
  };
  const attendee: BadgeAttendee = {
    id: "a", registrationId: "a", ticketId: 1, status: "CONFIRMED", displayName: "Ada", legalName: null,
    email: "ada@example.com", photoUrl: null, ticketTier: "Standard", eventName: "Test", customFieldData: {},
  };
  render(<BadgeDesigner eventId={7} eventName="Test" initialTemplates={[]} fallbackTemplate={template}
    initialAttendees={[attendee]} ticketTiers={[]} customFields={[]} />);
  expect(screen.getByText("0 / 1 layers visible")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Badge preview" })).queryByText("SPONSOR ACCESS")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add background rule" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "Value" })[0], { target: { value: "Standard" } });
  expect(screen.getByText("Adaptive background matched")).toBeInTheDocument();
  const values = screen.getAllByRole("textbox", { name: "Value" });
  fireEvent.change(values[1], { target: { value: "Standard" } });
  expect(screen.getByText("1 / 1 layers visible")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Badge preview" })).getByText("SPONSOR ACCESS")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add badge to queue" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Edited design" } });
  const current = screen.getByText("1. Current design: Edited design").parentElement!;
  fireEvent.click(within(current).getByRole("button", { name: "Move down" }));
  expect(screen.getByText("1. Default Badge")).toBeInTheDocument();
  expect(screen.getByText("2. Current design: Edited design")).toBeInTheDocument();
  expect(screen.getByText("2 badges per attendee · 2 total")).toBeInTheDocument();
});
