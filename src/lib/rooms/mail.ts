import RoomInvitationMail from "@/components/emails/RoomInvitationMail";
import { renderComponentToHTML } from "@/lib/helpers/html";
import { sendMail } from "@/lib/mail";

export type RoomInvitationMailData = {
  to: string;
  inviterName: string;
  eventName: string;
  roomTypeName: string;
  /** App-relative link, e.g. /events/1/room?invite=… */
  link: string;
  expiresAt: Date;
};

function appBaseUrl() {
  return process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "https://local.dev:3443";
}

/** Best effort: a failed mail must not undo the invitation; the in-app notification still exists. */
export async function sendRoomInvitationMail(mail: RoomInvitationMailData) {
  try {
    const html = await renderComponentToHTML(RoomInvitationMail, {
      inviterName: mail.inviterName,
      eventName: mail.eventName,
      roomTypeName: mail.roomTypeName,
      inviteUrl: `${appBaseUrl()}${mail.link}`,
      expiresAt: mail.expiresAt.toUTCString(),
    });
    await sendMail(mail.to, `Roommate invitation: ${mail.eventName}`, html);
  } catch (error) {
    console.error("Failed to send roommate invitation email:", error);
  }
}
