import {
  checkEventAdminAuth as _checkEventAdminAuth,
  type EventAdminAuthResult,
} from "@/lib/auth/admin";
import type { AdminOrgPermission } from "@/generated/prisma";

export type { EventAdminAuthResult };

/**
 * Thin wrapper around admin.ts checkEventAdminAuth that preserves the original
 * (eventId, requestHeaders, requiredPermission?) call signature used by all
 * event-scoped API routes.
 */
export async function checkEventAdminAuth(
  eventId: number,
  requestHeaders?: Headers,
  requiredPermission?: AdminOrgPermission,
  requireWrite = false,
): Promise<EventAdminAuthResult> {
  return _checkEventAdminAuth(eventId, requiredPermission, requestHeaders, requireWrite);
}
