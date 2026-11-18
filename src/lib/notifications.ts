import { prisma } from "@/lib/prisma/prisma";
import { publishNotificationEvent } from "@/lib/notifications-live";
import type { NotificationType } from "@/generated/prisma";

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  link?: string,
) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, body: body ?? null, link: link ?? null },
  });
  await publishNotificationEvent(userId);
  return notification;
}
