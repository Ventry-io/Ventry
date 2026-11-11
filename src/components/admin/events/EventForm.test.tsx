import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EventForm from "./EventForm";

async function addDropdownCustomField() {
  fireEvent.click(screen.getByRole("switch", { name: "Advanced settings, tickets and additional features" }));
  fireEvent.click(screen.getByRole("tab", { name: "Custom Fields" }));
  fireEvent.click(screen.getByRole("button", { name: /Add Field/ }));

  fireEvent.mouseDown(screen.getByLabelText("Input Type"));
  fireEvent.click(await screen.findByRole("option", { name: "Dropdown" }));

  fireEvent.click(screen.getByRole("button", { name: /Add Option/ }));
}

describe("EventForm banner preview", () => {
  it("previews the banner at the same aspect ratio it's cropped and stored at (1200x630)", () => {
    render(<EventForm onSubmit={vi.fn()} initialData={{ imageUrl: "https://example.com/banner.jpg" }} />);

    const preview = screen.getByAltText("Preview");
    // The old fixed-height box (e.g. 320px tall, 100% wide) rendered at
    // whatever ratio the container happened to be, so `objectFit: cover`
    // re-cropped the already-cropped 1200x630 image a second time,
    // differently. Matching the container's aspect-ratio to the stored
    // image ratio means cover has nothing left to re-crop.
    expect(getComputedStyle(preview.parentElement as Element).aspectRatio).toBe("1200/630");
  });
});

describe("EventForm custom field dropdown options", () => {
  it("keeps focus in the same input across keystrokes instead of remounting it", async () => {
    render(<EventForm onSubmit={vi.fn()} />);
    await addDropdownCustomField();

    const input = screen.getByPlaceholderText("Option 1") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "R" } });

    // A content-derived `key` remounts the row on every keystroke, replacing
    // this element with a brand-new DOM node and dropping focus - this is
    // the exact bug being guarded against.
    const inputAfterKeystroke = screen.getByPlaceholderText("Option 1");
    expect(inputAfterKeystroke).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("still lets the same input accumulate multiple keystrokes", async () => {
    render(<EventForm onSubmit={vi.fn()} />);
    await addDropdownCustomField();

    const input = screen.getByPlaceholderText("Option 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "R" } });
    fireEvent.change(screen.getByDisplayValue("R"), { target: { value: "Re" } });
    fireEvent.change(screen.getByDisplayValue("Re"), { target: { value: "Red" } });

    expect(screen.getByDisplayValue("Red")).toBe(input);
  });
});

describe("simple event creation", () => {
  it("saves basic details without inventing a ticket", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm onSubmit={onSubmit} initialData={{ name: "Park meeting", description: "At the entrance", startDate: "2027-05-01T12:00:00Z", endDate: "2027-05-01T14:00:00Z", location: { name: "Park", address: "Entrance", city: "Berlin", country: "DE" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Park meeting", products: [], requiresHotel: false })));
  });
});
