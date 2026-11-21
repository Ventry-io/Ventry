import { type NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { eventMediaBucket, eventMediaPath, getSignedUrl, uploadEventImage } from "@/lib/supabase";
import { MEDIA_CONFIG } from "@/lib/config";
import { buildJpegCompressionCandidate, isStorageSizeError } from "@/lib/images/compression";

const MAX_BANNER_BYTES = MEDIA_CONFIG.MAX_EVENT_BANNER_SIZE_MB * 1024 * 1024;
const MAX_BANNER_STORAGE_BYTES = MEDIA_CONFIG.MAX_EVENT_BANNER_STORAGE_SIZE_MB * 1024 * 1024;
const BANNER_COMPRESSION_ATTEMPTS = [
    { width: 1200, height: 630, fit: "cover" as const, quality: 78 },
    { width: 1200, height: 630, fit: "cover" as const, quality: 68 },
    { width: 1100, height: 578, fit: "cover" as const, quality: 58 },
    { width: 960, height: 504, fit: "cover" as const, quality: 50 },
    { width: 820, height: 431, fit: "cover" as const, quality: 42 },
];
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
const FOLDERS = { banner: "banner", "badge-background": "badges", "badge-photo": "badge-photos" } as const;
const BADGE_PHOTO_COMPRESSION_ATTEMPTS = [
    { width: 900, height: 900, fit: "cover" as const, quality: 75 },
];

function bannerTooLargeResponse() {
    return NextResponse.json({
        error: `Banner image must be ${MEDIA_CONFIG.MAX_EVENT_BANNER_SIZE_MB}MB or smaller before optimization`
    }, { status: 413 });
}

export async function POST(req: NextRequest) {
    try {
        // 1. Check Admin Auth
        const authResult = await checkAdminAuth(req.headers);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        // 2. Parse Form Data
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return bannerTooLargeResponse();
        }

        const file = formData.get("file") as File | null;
        const rawMode = formData.get("mode");
        const mode = rawMode === "badge-photo" || rawMode === "badge-background" ? rawMode : "banner";
        // Without an event (create form) the file is kept in the uploading admin's drafts folder.
        const eventId = formData.get("eventId");
        if (eventId !== null) {
            if (typeof eventId !== "string" || !/^[1-9]\d*$/.test(eventId)) {
                return NextResponse.json({ error: "Invalid event" }, { status: 400 });
            }
            const access = await checkEventAdminAuth(Number(eventId), req.headers, undefined, true);
            if (!access.authorized) return forbiddenResponse(access.error);
        }

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        if (typeof file.arrayBuffer !== "function") {
            return NextResponse.json({ error: "Invalid file uploaded" }, { status: 400 });
        }

        const banner = mode !== "badge-photo";
        if (banner && typeof file.size === "number" && file.size > MAX_BANNER_BYTES) {
            return bannerTooLargeResponse();
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        if (banner && bytes.length > MAX_BANNER_BYTES) {
            return bannerTooLargeResponse();
        }

        const folder = FOLDERS[mode];
        const path = eventMediaPath({ eventId: eventId ? Number(eventId) : undefined, adminId: authResult.adminId }, folder, "jpg");
        const bucket = eventMediaBucket(folder);
        const attempts = banner ? BANNER_COMPRESSION_ATTEMPTS : BADGE_PHOTO_COMPRESSION_ATTEMPTS;
        let uploadResult: Awaited<ReturnType<typeof uploadEventImage>> | null = null;

        for (const attempt of attempts) {
            const candidate = await buildJpegCompressionCandidate(bytes, attempt);

            if (banner && candidate.buffer.length > MAX_BANNER_STORAGE_BYTES) {
                continue;
            }

            try {
                uploadResult = await uploadEventImage(candidate.buffer, path, bucket);
                break;
            } catch (error) {
                if (!banner || !isStorageSizeError(error)) {
                    throw error;
                }
            }
        }

        if (!uploadResult) {
            return NextResponse.json({
                error: `Could not optimize banner below ${MEDIA_CONFIG.MAX_EVENT_BANNER_STORAGE_SIZE_MB}MB`
            }, { status: 413 });
        }

        // Event assets are public page content and are stored as URLs, so they must not expire after a year.
        const signedUrlData = await getSignedUrl(uploadResult.path, bucket === "banners" ? TEN_YEARS : 365 * 24 * 60 * 60, bucket);

        return NextResponse.json({ 
            url: signedUrlData.signedUrl,
            path: uploadResult.path
        }, { status: 200 });

    } catch (error) {
        console.error("Error uploading event image:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
