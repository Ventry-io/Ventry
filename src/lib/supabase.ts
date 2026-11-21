import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

let supabaseClient: ReturnType<typeof createClient> | null = null;
type StorageBucket = "profile" | "banners";

function getSupabaseClient() {
    if(!supabaseClient) {
        supabaseClient = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_API_KEY
        );
    }

    return supabaseClient;
}

export async function healthCheck() {
    const buckets = new Set([getBucketName("profile"), getBucketName("banners")]);
    await Promise.all([...buckets].map(async (bucket) => {
        if (!bucket) {
            throw Object.assign(new Error("Supabase storage bucket not configured"), {
                code: "MISSING_BUCKET_ID",
            });
        }
        const { error } = await getSupabaseClient().storage.getBucket(bucket);
        if (error) throw error;
    }));
    return true;
}

function getBucketName(bucket: StorageBucket = "profile") {
    if (bucket === "banners") {
        return process.env.SUPABASE_BANNERS_BUCKET_ID || "banners";
    }

    return process.env.SUPABASE_BUCKET_ID;
}

export async function uploadProfilePicture(file: File | Buffer, userId: string, fileName?: string) {
    const name = fileName || (file as File).name;
    if (!name) {
        throw new Error("File name is required when uploading a Buffer");
    }

    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName("profile"))
        .upload(`users/${userId}/${name}`, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: 'image/jpeg' // Explicitly set content type for processed images
    });

    if(error) throw error;
    return data;
}

/**
 * Storage layout (see README "Media storage"):
 * - banners bucket, event assets: events/<eventId>/{banner,page,fonts,badges}/<uuid>.<ext>
 * - profile bucket, personal data: users/<userId>/…, community/<eventId>/<userId>/…, events/<eventId>/badge-photos/…
 * Uploads made before the event exists (create form) go to drafts/<adminId>/<folder>/.
 */
export type EventMediaFolder = "banner" | "page" | "fonts" | "badges" | "badge-photos";

export function eventMediaPath(owner: { eventId?: number; adminId?: string }, folder: EventMediaFolder, extension: string) {
    const root = owner.eventId ? `events/${owner.eventId}` : `drafts/${owner.adminId || "unknown"}`;
    return `${root}/${folder}/${randomUUID()}.${extension}`;
}

export const eventMediaBucket = (folder: EventMediaFolder): StorageBucket => folder === "badge-photos" ? "profile" : "banners";

export async function uploadEventImage(file: Buffer, path: string, bucket: StorageBucket = "profile", contentType = "image/jpeg") {
    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName(bucket))
        .upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType
    });

    if(error) throw error;
    return data;
}

export async function uploadCommunityImage(file: Buffer, eventId: number, userId: string, fileName: string, contentType: string = "image/jpeg") {
    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName("profile"))
        .upload(`community/${eventId}/${userId}/${fileName}`, file, {
            cacheControl: '3600',
            upsert: false,
            contentType,
    });

    if(error) throw error;
    return data;
}


export async function getSignedUrl(path: string, expiresIn: number = 300, bucket: StorageBucket = "profile") {
    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName(bucket))
        .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return {...data, expiresIn: expiresIn};
}

export async function deleteProfilePicture(objectKey: string) {
    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName("profile"))
        .remove([objectKey]);
        
    if (error) throw error;
    return data;
}

const LIST_PAGE = 1000;

/** All object paths below a folder; Supabase lists one level at a time and marks folders with id null. */
async function listFiles(bucket: string, prefix: string): Promise<string[]> {
    const files: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
        // Trailing slash: list exactly this folder, so events/7 never matches events/70.
        const { data, error } = await getSupabaseClient().storage.from(bucket).list(`${prefix}/`, { limit: LIST_PAGE, offset });
        if (error) throw error;
        for (const entry of data) {
            const path = `${prefix}/${entry.name}`;
            if (entry.id) files.push(path);
            else files.push(...await listFiles(bucket, path));
        }
        if (data.length < LIST_PAGE) return files;
    }
}

/** Bucket and object path of a Supabase storage URL from this project, or null for anything else. */
export function storageObjectFromUrl(value: string) {
    try {
        const url = new URL(value);
        if (!process.env.SUPABASE_URL || url.origin !== new URL(process.env.SUPABASE_URL).origin) return null;
        const match = url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
        return match ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) } : null;
    } catch {
        return null;
    }
}

/**
 * Removes the stored files of a deleted event: its events/<id>/ folders in both buckets, its community
 * images and a banner still in the creator's drafts folder. Files from before the event-scoped layout
 * (flat events/ folder) can't be attributed to one event and stay.
 */
export async function deleteEventMedia(eventId: number, bannerUrl?: string | null) {
    const banners = getBucketName("banners");
    const profile = getBucketName("profile");
    const targets = new Map<string, Set<string>>();
    const add = (bucket: string, paths: string[]) => {
        const set = targets.get(bucket) ?? new Set<string>();
        for (const path of paths) set.add(path);
        targets.set(bucket, set);
    };
    for (const [bucket, prefix] of [[banners, `events/${eventId}`], [profile, `events/${eventId}`], [profile, `community/${eventId}`]]) {
        add(bucket, await listFiles(bucket, prefix));
    }
    const banner = bannerUrl ? storageObjectFromUrl(bannerUrl) : null;
    if (banner?.bucket === banners && banner.path.startsWith("drafts/")) add(banners, [banner.path]);

    let removed = 0;
    for (const [bucket, set] of targets) {
        const paths = [...set];
        for (let i = 0; i < paths.length; i += LIST_PAGE) {
            const { error } = await getSupabaseClient().storage.from(bucket).remove(paths.slice(i, i + LIST_PAGE));
            if (error) throw error;
            removed += Math.min(LIST_PAGE, paths.length - i);
        }
    }
    return removed;
}
