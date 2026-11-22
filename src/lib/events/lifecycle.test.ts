import { describe, expect, it } from "vitest";
import { eventStage } from "./lifecycle";

const now = new Date("2026-04-20T12:00:00Z");
const base = { status: "PUBLISHED", startDate: new Date("2026-05-03T10:00:00Z"), endDate: new Date("2026-05-05T18:00:00Z") };

describe("eventStage", () => {
  it.each([
    ["draft", { ...base, status: "DRAFT" }],
    ["published", { ...base, status: "DRAFT", publishAt: new Date("2026-04-01T00:00:00Z"), registrationOpensAt: new Date("2026-04-25T00:00:00Z") }],
    ["registration", base],
    ["registration", { ...base, registrationOpensAt: new Date("2026-04-01T00:00:00Z") }],
    ["live", { ...base, startDate: new Date("2026-04-20T08:00:00Z") }],
    ["past", { ...base, startDate: new Date("2026-04-01T08:00:00Z"), endDate: new Date("2026-04-02T08:00:00Z") }],
    ["cancelled", { ...base, status: "CANCELLED" }],
    ["draft", { ...base, status: "DRAFT", publishAt: new Date("2026-05-01T00:00:00Z") }],
  ])("is %s", (stage, event) => {
    expect(eventStage(event, now)).toBe(stage);
  });
});
