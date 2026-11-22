export const EVENT_STAGES = ["draft", "published", "registration", "live", "past"] as const;
export type EventStage = (typeof EVENT_STAGES)[number] | "cancelled";

type LifecycleEvent = {
  status: string;
  publishAt?: Date | null;
  registrationOpensAt?: Date | null;
  startDate: Date;
  endDate: Date;
};

/** Where an event is in its life, using the same visibility rule as the public page (a draft with a past publishAt is live). */
export function eventStage(event: LifecycleEvent, now = new Date()): EventStage {
  if (event.status === "CANCELLED") return "cancelled";
  const published = event.status === "PUBLISHED" || (event.status === "DRAFT" && !!event.publishAt && event.publishAt <= now);
  if (!published) return "draft";
  if (now > event.endDate) return "past";
  if (now >= event.startDate) return "live";
  if (!event.registrationOpensAt || event.registrationOpensAt <= now) return "registration";
  return "published";
}
