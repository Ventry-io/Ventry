import type { Prisma } from "@/generated/prisma";

export function withEventScope(filter: Prisma.EventWhereInput, eventId: string): Prisma.EventWhereInput {
  const id = /^[1-9]\d*$/.test(eventId) && Number.isSafeInteger(Number(eventId)) ? Number(eventId) : -1;
  return { AND: [filter, { id }] };
}
