import { prisma } from "@/lib/prisma/prisma";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";

const MAX_ATTEMPTS = 50;

/**
 * `User.username` doubles as the public profile slug at /profile/[username],
 * so it uses letters, numbers, dots, hyphens and underscores only.
 */
export function sanitizeUsername(raw: string): string {
    return raw.trim().replace(/[^\p{L}\p{N}_.-]+/gu, "-");
}

/**
 * A username is unavailable if it's live on another user, or reserved by a
 * not-yet-expired entry in `UsernameHistory` (the 90-day post-rename hold -
 * see changeUsername in ./change-username.ts). Excluding the acting user lets
 * them keep/reclaim their own current or recently-vacated name.
 */
export async function isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const [userConflict, historyConflict] = await Promise.all([
        prisma.user.findFirst({
            where: { username, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
            select: { id: true },
        }),
        prisma.usernameHistory.findFirst({
            where: {
                username,
                expiresAt: { gt: new Date() },
                ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
            },
            select: { id: true },
        }),
    ]);
    return !userConflict && !historyConflict;
}

/**
 * OAuth providers hand back a plain display name, but `User.username` is
 * unique, so two people with the same name colliding would otherwise fail
 * the signup DB write. Sanitizes spaces out first, then appends a hyphenated
 * numeric suffix until a free (and non-reserved) username is found.
 */
export async function resolveUniqueUsername(candidate: string): Promise<string> {
    const sanitized = sanitizeUsername(candidate);
    const base = (sanitized.length >= 3 ? sanitized : `${sanitized || "user"}-user`).slice(0, DISPLAY_NAME_MAX_LENGTH);
    let username = base;
    for (let suffix = 2; suffix <= MAX_ATTEMPTS; suffix++) {
        if (await isUsernameAvailable(username)) return username;
        username = `${base.slice(0, DISPLAY_NAME_MAX_LENGTH - String(suffix).length - 1)}-${suffix}`;
    }
    return `${base.slice(0, DISPLAY_NAME_MAX_LENGTH - 9)}-${crypto.randomUUID().slice(0, 8)}`;
}
