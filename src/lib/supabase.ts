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

export async function uploadEventImage(file: Buffer, fileName: string, bucket: StorageBucket = "profile") {
    const { data, error } = await getSupabaseClient().storage
        .from(getBucketName(bucket))
        .upload(`events/${fileName}`, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: 'image/jpeg'
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
