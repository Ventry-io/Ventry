import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { NotificationType, SupportTicketStatus } from "@/generated/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { prisma } from "@/lib/prisma/prisma";
import { renderComponentToHTML } from "@/lib/helpers/html";
import { sendMail } from "@/lib/mail";
import SupportTicketStatusMail from "@/components/emails/SupportTicketStatusMail";
import { createNotification } from "@/lib/notifications";

const updateSupportTicketSchema = z
  .object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
    adminResponse: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.adminResponse !== undefined, {
    message: "Provide at least one field to update",
  });

function getAppBaseUrl() {
  return process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "https://local.dev:3443";
}

const updatedTicketInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  registration: {
    select: {
      id: true,
      ticketId: true,
    },
  },
} satisfies Prisma.SupportTicketInclude;

type UpdatedTicketRow = Prisma.SupportTicketGetPayload<{
  include: typeof updatedTicketInclude;
}>;

function serializeAdminTicket(ticket: UpdatedTicketRow) {
  return {
    ...ticket,
    resolvedAt: ticket.resolvedAt?.toISOString() || null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  try {
    const { id: eventIdRaw, ticketId } = await params;
    const eventId = Number(eventIdRaw);

    if (Number.isNaN(eventId)) {
      return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    }

    const authResult = await checkEventAdminAuth(eventId, req.headers, "SUPPORT_TICKETS", true);
    if (!authResult.authorized) {
      if (authResult.error === "Event not found") {
        return NextResponse.json({ error: authResult.error }, { status: 404 });
      }
      return forbiddenResponse(authResult.error);
    }

    const body = await req.json();
    const parsed = updateSupportTicketSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 422 });
    }

    const existing = await prisma.supportTicket.findFirst({
      where: {
        id: ticketId,
        eventId,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        event: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Support ticket not found" }, { status: 404 });
    }

    const nextStatus = parsed.data.status ?? existing.status;
    const nextAdminResponse =
      parsed.data.adminResponse === undefined
        ? existing.adminResponse
        : parsed.data.adminResponse && parsed.data.adminResponse.length > 0
          ? parsed.data.adminResponse
          : null;

    const shouldSetResolvedAt = nextStatus === "RESOLVED" || nextStatus === "CLOSED";

    const updated = await prisma.supportTicket.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        adminResponse: nextAdminResponse,
        lastUpdatedByAdminId: authResult.adminId,
        resolvedAt: shouldSetResolvedAt ? existing.resolvedAt || new Date() : null,
      },
      include: updatedTicketInclude,
    }) as UpdatedTicketRow;

    const statusChanged = existing.status !== updated.status;
    const responseChanged = (existing.adminResponse || "") !== (updated.adminResponse || "");

    if (statusChanged || responseChanged) {
      try {
        const eventUrl = `${getAppBaseUrl()}/events/${existing.event.id}`;
        const html = await renderComponentToHTML(SupportTicketStatusMail, {
          userName: existing.user.name || "Attendee",
          eventName: existing.event.name,
          eventUrl,
          ticketId: existing.id,
          status: updated.status,
          adminResponse: updated.adminResponse,
        });

        await sendMail(
          existing.user.email,
          `Support Ticket Updated: ${existing.event.name}`,
          html,
        );
      } catch (mailError) {
        console.error("Failed to send support ticket update email:", mailError);
      }

      try {
        await createNotification(
          updated.user.id,
          NotificationType.EVENT,
          `Support ticket updated: ${existing.event.name}`,
          statusChanged
            ? `Status changed from ${existing.status} to ${updated.status}`
            : "An organizer replied to your support ticket",
          `/events/${existing.event.id}`,
        );
      } catch (notificationError) {
        console.error("Failed to create support ticket update notification:", notificationError);
      }
    }

    return NextResponse.json({ ticket: serializeAdminTicket(updated) }, { status: 200 });
  } catch (error) {
    console.error("Error updating support ticket:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
